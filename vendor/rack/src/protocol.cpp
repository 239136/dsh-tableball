#include "protocol.h"

#include <QHostAddress>
#include <QJsonDocument>
#include <QNetworkInterface>
#include <QRegularExpression>

QByteArray Protocol::encode(const QJsonObject &object)
{
    return QJsonDocument(object).toJson(QJsonDocument::Compact) + '\n';
}

bool Protocol::decode(const QByteArray &line, QJsonObject *object)
{
    if (line.size() > MaxLineBytes)
        return false;
    QJsonParseError error;
    const auto document = QJsonDocument::fromJson(line, &error);
    if (error.error != QJsonParseError::NoError || !document.isObject())
        return false;
    *object = document.object();
    return true;
}

bool Protocol::parseAddress(const QString &address, QString *host, quint16 *port)
{
    QString text = address.trimmed();
    if (text.isEmpty())
        return false;

    quint16 parsedPort = TcpPort;
    // Accept host, host:port, and [ipv6]:port.
    static const QRegularExpression bracketed("^\\[([^]]+)\\](?::(\\d+))?$");
    const auto match = bracketed.match(text);
    if (match.hasMatch()) {
        text = match.captured(1);
        if (!match.captured(2).isEmpty())
            parsedPort = static_cast<quint16>(match.captured(2).toUShort());
    } else {
        const int colon = text.lastIndexOf(QLatin1Char(':'));
        if (colon > 0 && text.count(QLatin1Char(':')) == 1) {
            const QString portText = text.mid(colon + 1);
            bool ok = false;
            const uint value = portText.toUInt(&ok);
            if (ok && value > 0 && value <= 65535) {
                parsedPort = static_cast<quint16>(value);
                text = text.left(colon);
            }
        }
    }

    if (text.isEmpty())
        return false;
    *host = text;
    *port = parsedPort;
    return true;
}

QString Protocol::localAddress()
{
    // Prefer a real LAN address over loopback so the lobby can show something
    // a friend can type.
    for (const auto &interface : QNetworkInterface::allInterfaces()) {
        const auto flags = interface.flags();
        if (!(flags & QNetworkInterface::IsUp) || !(flags & QNetworkInterface::IsRunning)
            || (flags & QNetworkInterface::IsLoopBack))
            continue;
        for (const auto &entry : interface.addressEntries()) {
            const auto address = entry.ip();
            if (address.protocol() == QAbstractSocket::IPv4Protocol)
                return address.toString();
        }
    }
    return QStringLiteral("127.0.0.1");
}
