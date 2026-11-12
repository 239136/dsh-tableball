#include "hostserver.h"

#include "protocol.h"

#include <QHostAddress>
#include <QJsonDocument>
#include <QTcpSocket>

HostServer::HostServer(QObject *parent) : QObject(parent)
{
    connect(&m_server, &QTcpServer::newConnection, this, [this] {
        while (QTcpSocket *socket = m_server.nextPendingConnection()) {
            if (m_peers.size() >= 2) {
                socket->write(Protocol::encode({{"t", "reject"}, {"reason", tr("This table is full.")}}));
                socket->disconnectFromHost();
                socket->deleteLater();
                continue;
            }

            const int id = m_nextPeer++;
            auto *peer = new Peer;
            peer->socket = socket;
            m_peers.insert(id, peer);

            connect(socket, &QTcpSocket::readyRead, this, [this, id] {
                auto *peer = m_peers.value(id);
                if (!peer)
                    return;
                peer->buffer += peer->socket->readAll();
                if (peer->buffer.size() > Protocol::MaxLineBytes * 4) {
                    fail(id, tr("Too much data."));
                    return;
                }
                while (true) {
                    const int newline = peer->buffer.indexOf('\n');
                    if (newline < 0)
                        break;
                    const QByteArray line = peer->buffer.left(newline);
                    peer->buffer.remove(0, newline + 1);
                    handleLine(id, line);
                    if (!m_peers.contains(id))
                        return;
                }
            });
            connect(socket, &QTcpSocket::disconnected, this, [this, id] { drop(id); });
            connect(socket, &QTcpSocket::errorOccurred, this, [this, id](QAbstractSocket::SocketError) {
                if (m_peers.contains(id))
                    fail(id, tr("The connection failed."));
            });
        }
    });
}

HostServer::~HostServer()
{
    stop();
}

bool HostServer::listen(quint16 port, QString *error)
{
    if (!m_server.listen(QHostAddress::Any, port)) {
        if (error)
            *error = m_server.errorString();
        return false;
    }
    return true;
}

quint16 HostServer::port() const
{
    return m_server.serverPort();
}

void HostServer::stop()
{
    const auto ids = m_peers.keys();
    for (int id : ids) {
        auto *peer = m_peers.take(id);
        if (!peer)
            continue;
        peer->socket->disconnect(this);
        peer->socket->disconnectFromHost();
        peer->socket->deleteLater();
        delete peer;
    }
    m_server.close();
}

void HostServer::send(int peerId, const QJsonObject &object)
{
    auto *peer = m_peers.value(peerId);
    if (!peer || peer->socket->state() != QAbstractSocket::ConnectedState)
        return;
    peer->socket->write(Protocol::encode(object));
}

void HostServer::sendWelcome(int peer, int player, int rules, const QString &host,
                             const QJsonObject &hostAttestation)
{
    send(peer, {{"t", "welcome"},
                {"v", Protocol::Version},
                {"player", player},
                {"rules", rules},
                {"host", host},
                {"hostAttest", hostAttestation}});
}

void HostServer::sendLobby(int peer, const QJsonArray &players, int rules)
{
    send(peer, {{"t", "lobby"}, {"players", players}, {"rules", rules}});
}

void HostServer::sendStart(int peer, const QJsonObject &snapshot)
{
    send(peer, {{"t", "start"}, {"snapshot", snapshot}});
}

void HostServer::sendReject(int peer, const QString &reason)
{
    send(peer, {{"t", "reject"}, {"reason", reason}});
}

void HostServer::kick(int peer, const QString &reason)
{
    sendReject(peer, reason);
    auto *value = m_peers.value(peer);
    if (value)
        QMetaObject::invokeMethod(value->socket, "disconnectFromHost", Qt::QueuedConnection);
}

void HostServer::broadcast(const QJsonObject &object)
{
    const auto ids = m_peers.keys();
    for (int id : ids)
        send(id, object);
}

void HostServer::fail(int peer, const QString &reason)
{
    sendReject(peer, reason);
    drop(peer);
}

void HostServer::drop(int peerId)
{
    auto *peer = m_peers.take(peerId);
    if (!peer)
        return;
    peer->socket->disconnect(this);
    peer->socket->deleteLater();
    delete peer;
    emit disconnected(peerId);
}

void HostServer::handleLine(int peerId, const QByteArray &line)
{
    auto *peer = m_peers.value(peerId);
    if (!peer || line.trimmed().isEmpty())
        return;

    QJsonObject object;
    if (!Protocol::decode(line, &object)) {
        fail(peerId, tr("Malformed message."));
        return;
    }

    const QString type = object.value("t").toString();

    if (!peer->helloDone) {
        if (type != QLatin1String("hello") || object.value("v").toInt() != Protocol::Version) {
            fail(peerId, tr("This table speaks a different Rack protocol."));
            return;
        }
        const QString name = object.value("name").toString().trimmed().left(24);
        if (name.isEmpty()) {
            fail(peerId, tr("A player name is required."));
            return;
        }
        peer->helloDone = true;
        peer->name = name;
        emit hello(peerId, name, object.value("attest").toObject());
        return;
    }

    if (type == QLatin1String("ping")) {
        send(peerId, {{"t", "pong"}, {"id", object.value("id")}});
    } else if (type == QLatin1String("ready")) {
        peer->ready = object.value("ready").toBool(true);
        emit ready(peerId, peer->ready);
    } else if (type == QLatin1String("shoot")) {
        emit shot(peerId, object.value("angle").toDouble(), object.value("power").toDouble());
    } else if (type == QLatin1String("place")) {
        emit place(peerId, object.value("x").toDouble(), object.value("y").toDouble());
    } else if (type == QLatin1String("aim")) {
        emit aim(peerId, object.value("angle").toDouble());
    } else if (type == QLatin1String("chat")) {
        emit chat(peerId, object.value("text").toString().left(400));
    } else if (type == QLatin1String("rematch")) {
        emit rematch(peerId);
    } else if (type == QLatin1String("leave")) {
        drop(peerId);
    }
}
