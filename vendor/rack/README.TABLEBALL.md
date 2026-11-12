# Rack 上游来源与复用边界

- 上游：https://github.com/Nick7612/rack
- 固定提交：6383542887caa822296c883e72391adba86ca82c
- [MIT原文](<LICENSE>)必须随复用代码保留；Copyright (c) 2026 Nick7612。
- 选取的上游源码未修改；[校验清单](<UPSTREAM.json>)记录SHA-256。

## 复用依据

1. [规则和快照](<web/js/game.js>)、[物理](<web/js/physics.js>)已有8球/9球、轮流、犯规和胜负；不采用先前自拟积分制。
2. [房主](<src/hostserver.cpp>)、[客户端](<src/gameclient.cpp>)、[正式协议](<docs/PROTOCOL.md>)已有TCP局域网连接、完整state快照及aim消息，使对端可画球杆。
3. [瞄准](<web/js/aim.js>)和[原测试](<web/tests/game.test.mjs>)用于回归；原规则、瞄准、房码共29项测试在本工作区通过。

## 移植边界

- 原生程序是Qt/Omarchy，不是Windows/Electron即插即用组件。
- [网页网络层](<web/js/net.js>)默认PeerJS公共信令，不可当作无需互联网的纯局域网；其房码辅助也不是TCP联机服务器。
- 联机接入优先移植原生TCP协议和球杆aim通道，沿用现有JS规则/物理，不能只同步球坐标。
- 原生协议含Omarchy声明；TableBall应使用自己的应用标识/协议版本，不伪造平台身份或接入原社区房间。
- 新的桌面输入、Esc退场及恢复保护需要TableBall适配层，不直接执行上游安装脚本。
- TableBall主程序已通过Rack会话适配器接入本目录的规则/物理和移植TCP协议；先前自拟LAN原型已删除。已做同机TCP双端、不同分辨率实际渲染及跨进程主程序测试，尚未进行真实双设备验收。
