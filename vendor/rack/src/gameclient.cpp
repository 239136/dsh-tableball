#include "gameclient.h"

#include "protocol.h"

#include <QJsonDocument>

GameClient::GameClient(QObject *parent) : QObject(parent)
{
    m_handshakeTimeout.setSingleShot(true);
    m_handshakeTimeout.setInterval(6000);

    connect(&m_handshakeTimeout, &QTimer::timeout, this, [this] {
        if (!m_joined)
            fail(tr("The table did not answer. Check the address and firewall."), true);
    });

    connect(&m_socket, &QTcpSocket::connected, this, [this] {
        emit connected();
        send({{"t", "hello"},
              {"v", Protocol::Version},
              {"name", m_name},
              {"attest", m_attestation}});
    });

    connect(&m_socket, &QTcpSocket::readyRead, this, [this] {
        m_buffer += m_socket.readAll();
        if (m_buffer.size() > Protocol::MaxLineBytes * 4) {
            fail(tr("The host sent too much data."), true);
            return;
        }
        while (true) {
            const int newline = m_buffer.indexOf('\n');
            if (newline < 0)
                break;
            const QByteArray line = m_buffer.left(newline);
            m_buffer.remove(0, newline + 1);
            handleLine(line);
            if (m_closing)
                return;
        }
    });

    connect(&m_socket, &QTcpSocket::disconnected, this, [this] {
        if (!m_closing)
            emit disconnected(tr("The host left the table."));
        reset();
    });

    connect(&m_socket, &QTcpSocket::errorOccurred, this, [this](QAbstractSocket::SocketError) {
        if (!m_closing)
            fail(m_socket.errorString(), false);
    });
}

void GameClient::connectToHost(const QString &host, quint16 port, const QString &name,
                               const QJsonObject &attestation)
{
    disconnectFromHost();
    reset();
    m_name = name;
    m_attestation = attestation;
    m_closing = false;
    m_joined = false;
    m_handshakeTimeout.start();
    m_socket.connectToHost(host, port);
}

void GameClient::disconnectFromHost()
{
    m_closing = true;
    m_handshakeTimeout.stop();
    if (m_socket.state() != QAbstractSocket::UnconnectedState) {
        m_socket.write(Protocol::encode({{"t", "leave"}}));
        m_socket.flush();
        m_socket.disconnectFromHost();
        if (m_socket.state() != QAbstractSocket::UnconnectedState)
            m_socket.abort();
    }
    reset();
}

void GameClient::reset()
{
    m_buffer.clear();
    m_joined = false;
    m_player = 1;
}

bool GameClient::isConnected() const
{
    return m_socket.state() == QAbstractSocket::ConnectedState;
}

void GameClient::send(const QJsonObject &object)
{
    if (m_socket.state() == QAbstractSocket::ConnectedState)
        m_socket.write(Protocol::encode(object));
}

void GameClient::setReady(bool ready)
{
    send({{"t", "ready"}, {"ready", ready}});
}

void GameClient::sendShoot(double angle, double power)
{
    send({{"t", "shoot"}, {"angle", angle}, {"power", power}});
}

void GameClient::sendPlace(double x, double y)
{
    send({{"t", "place"}, {"x", x}, {"y", y}});
}

void GameClient::sendAim(double angle)
{
    send({{"t", "aim"}, {"angle", angle}});
}

void GameClient::sendChat(const QString &text)
{
    send({{"t", "chat"}, {"text", text.left(400)}});
}

void GameClient::sendRematch()
{
    send({{"t", "rematch"}});
}

void GameClient::fail(const QString &reason, bool socketError)
{
    if (m_closing)
        return;
    m_closing = true;
    m_handshakeTimeout.stop();
    if (socketError) {
        m_socket.abort();
        reset();
    }
    emit failed(reason);
}

void GameClient::handleLine(const QByteArray &line)
{
    if (line.trimmed().isEmpty())
        return;

    QJsonObject object;
    if (!Protocol::decode(line, &object)) {
        fail(tr("The host sent a malformed message."), true);
        return;
    }

    const QString type = object.value("t").toString();
    if (type == QLatin1String("welcome")) {
        m_joined = true;
        m_handshakeTimeout.stop();
        m_player = object.value("player").toInt(1);
        emit welcomed(m_player, object.value("rules").toInt(), object.value("host").toString(),
                      object.value("hostAttest").toObject());
    } else if (type == QLatin1String("reject")) {
        const QString reason = object.value("reason").toString(tr("The host refused the connection."));
        m_closing = true;
        m_handshakeTimeout.stop();
        m_socket.disconnectFromHost();
        emit rejected(reason);
    } else if (type == QLatin1String("lobby")) {
        emit lobbyReceived(object.value("players").toArray(), object.value("rules").toInt());
    } else if (type == QLatin1String("start")) {
        emit started(object.value("snapshot").toObject());
    } else if (type == QLatin1String("state")) {
        emit stateReceived(object.value("snapshot").toObject());
    } else if (type == QLatin1String("shot")) {
        emit shotReceived(object.value("by").toInt(), object.value("angle").toDouble(),
                          object.value("power").toDouble());
    } else if (type == QLatin1String("aim")) {
        emit aimReceived(object.value("from").toInt(), object.value("angle").toDouble());
    } else if (type == QLatin1String("chat")) {
        emit chatReceived(object.value("from").toInt(), object.value("name").toString(),
                          object.value("text").toString());
    } else if (type == QLatin1String("rematch")) {
        emit rematchRequested(object.value("from").toInt());
    } else if (type == QLatin1String("error")) {
        emit failed(object.value("message").toString());
    }
}
