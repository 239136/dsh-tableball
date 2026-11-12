# TableBall 组合分发许可范围

此一体包包含多个独立组件，不声称整包/所有资源均为MIT。

- TableBall自有台球、启动与适配代码：MIT；Rack：MIT，见[声明](<THIRD_PARTY_NOTICES.md>)和[原许可](<vendor/rack/LICENSE>)。
- 原版dsh-pet代码版权PC2005-cloud，MIT，见[原许可](<vendor/dsh-pet/LICENSE>)。本项目对桌面helper作独立profile与窗口标签适配，未移除原有功能。
- 桌宠运行程序包含GPL-3.0-only语音依赖@andresaya/edge-tts，不能仅凭外层MIT标记忽略GPL要求。本包保留许可和完整上游对应源码/构建材料：[语音源代码](<vendor/edge-tts-source/>)、[桌宠源代码](<vendor/dsh-pet-source/>)。分发相关组合作品时应遵守适用GPL条款；不将GPL代码标为单纯MIT。
- 官方角色、动画及其衍生素材：按上游公开CC BY-NC-SA 4.0条件和署名说明处理，见[桌宠资源声明](<PET-ASSET-NOTICES.md>)，不是MIT素材。
- 字体及其他另有权利范围的资源：维护者声明已取得本项目打包所需授权。授权文书不由本项目收集或公开，本声明不等于向所有下游授予额外使用/再分发权；其他使用场景需遵守相应权利方条件。没有声称已独立核验这些私密授权。
- OpenAI SDK：Apache-2.0；Anthropic SDK、zod、Electron下载辅助等依各自随包LICENSE/NOTICE执行。完整生产依赖由锁文件固定并随运行包携带，保留嵌套许可。
- Node与完整Electron/Chromium运行时来自官方固定版本发行物，其LICENSE与Chromium第三方声明必须和运行时一起分发。

用户配置、密钥、聊天记录、私人宠物包及授权文书均不属于分发内容。
