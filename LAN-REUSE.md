# 局域网联机开源选型

按用户要求先复用开源，不继续自拟联网协议和积分规则。沿用上游规则编号：0=八球，1=九球；TableBall默认九球，界面应显示规则名称而非数字。

| 候选 | 授权 | 实际核对 | 决定 |
| --- | --- | --- | --- |
| [Rack](https://github.com/Nick7612/rack) | MIT | 原生TCP局域网、状态快照、aim对端球杆；JS规则/物理可复用 | 首选，固定源码与29项原测已落盘 |
| [Polymatic Eight-Ball](https://github.com/piqnt/polymatic-example-eight-ball) | MIT | Node/TS、Socket.IO房间和主机权威；已读房间模块未覆盖实时aim同步 | 备选，不能直接满足全部球杆要求 |
| [Godot Multiplayer Billiards](https://github.com/fswienty/godot-multiplayer-billiards) | MIT | Godot项目，含GOTM大厅依赖，改造栈不同 | 不作为本次Electron基线 |

[固定上游与移植边界](<vendor/rack/README.TABLEBALL.md>) · [MIT许可](<vendor/rack/LICENSE>) · [正式联机协议](<vendor/rack/docs/PROTOCOL.md>)。

已按此基线接入TableBall的建房/加入、规则、快照和双方球杆显示，未接入先前自拟原型（已清理）。已通过同机真实TCP双端、不同分辨率渲染及房主/访客主程序测试；不能宣称已实测两台实体设备。[使用与现场验收](<LAN-GUIDE.md>)。
