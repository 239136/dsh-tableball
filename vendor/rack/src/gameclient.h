#pragma once

#include <QByteArray>
#include <QJsonArray>
#include <QJsonObject>
#include <QObject>
#include <QTcpSocket>
#include <QTimer>

class GameClient : public QObject {
    Q_OBJECT

public:
    explicit GameClient(QObject *parent = nullptr);

    void connectToHost(const QString &host, quint16 port, const QString &name,
                       const QJsonObject &attestation);
    void disconnectFromHost();
    bool isConnected() const;
    int player() const { return m_player; }

    void setReady(bool ready);
    void sendShoot(double angle, double power);
    void sendPlace(double x, double y);
    void sendAim(double angle);
    void sendChat(const QString &text);
    void sendRematch();

signals:
    void connected();
    void welcomed(int player, int rules, const QString &host, const QJsonObject &hostAttestation);
    void lobbyReceived(const QJsonArray &players, int rules);
    void started(const QJsonObject &snapshot);
    void stateReceived(const QJsonObject &snapshot);
    void shotReceived(int by, double angle, double power);
    void aimReceived(int from, double angle);
    void chatReceived(int from, const QString &name, const QString &text);
    void rematchRequested(int from);
    void rejected(const QString &reason);
    void disconnected(const QString &reason);
    void failed(const QString &reason);

private:
    void handleLine(const QByteArray &line);
    void send(const QJsonObject &object);
    void fail(const QString &reason, bool socketError);
    void reset();

    QTcpSocket m_socket;
    QByteArray m_buffer;
    QTimer m_handshakeTimeout;
    QString m_name;
    QJsonObject m_attestation;
    int m_player = 1;
    bool m_joined = false;
    bool m_closing = false;
};
