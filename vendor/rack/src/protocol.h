#pragma once

#include <QByteArray>
#include <QJsonObject>
#include <QString>

namespace Protocol {
constexpr int Version = 1;
constexpr quint16 TcpPort = 46321;
constexpr quint16 DiscoveryPort = 46322;
constexpr int MaxLineBytes = 16 * 1024;

QByteArray encode(const QJsonObject &object);
bool decode(const QByteArray &line, QJsonObject *object);
bool parseAddress(const QString &address, QString *host, quint16 *port);
QString localAddress();
}
