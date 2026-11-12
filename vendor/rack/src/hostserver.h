#pragma once

#include <QHash>
#include <QJsonArray>
#include <QJsonObject>
#include <QObject>
#include <QTcpServer>

class HostServer : public QObject {
    Q_OBJECT

public:
    explicit HostServer(QObject *parent = nullptr);
    ~HostServer() override;

    bool listen(quint16 port, QString *error = nullptr);
    quint16 port() const;
    void stop();
    int peerCount() const { return m_peers.size(); }
    int firstPeer() const { return m_peers.isEmpty() ? -1 : m_peers.constBegin().key(); }

    void send(int peer, const QJsonObject &object);
    void sendWelcome(int peer, int player, int rules, const QString &host,
                     const QJsonObject &hostAttestation);
    void sendLobby(int peer, const QJsonArray &players, int rules);
    void sendStart(int peer, const QJsonObject &snapshot);
    void sendReject(int peer, const QString &reason);
    void kick(int peer, const QString &reason);
    void broadcast(const QJsonObject &object);

signals:
    void hello(int peer, const QString &name, const QJsonObject &attestation);
    void ready(int peer, bool ready);
    void shot(int peer, double angle, double power);
    void place(int peer, double x, double y);
    void aim(int peer, double angle);
    void chat(int peer, const QString &text);
    void rematch(int peer);
    void disconnected(int peer);

private:
    struct Peer {
        QTcpSocket *socket = nullptr;
        QByteArray buffer;
        QString name;
        bool helloDone = false;
        bool ready = false;
    };

    void handleLine(int peer, const QByteArray &line);
    void drop(int peer);
    void fail(int peer, const QString &reason);

    QTcpServer m_server;
    QHash<int, Peer *> m_peers;
    int m_nextPeer = 1;
};
