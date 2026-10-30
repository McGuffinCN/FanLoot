# FanLoot

[![Greasy Fork](https://img.shields.io/greasyfork/v/601998?label=Greasy%20Fork&style=for-the-badge&logo=greasyfork&logoColor=white&color=c90000)](https://greasyfork.org/zh-CN/scripts/601998-fanloot-%E5%85%A8%E8%83%BD%E8%B5%9E%E5%8A%A9%E5%B9%B3%E5%8F%B0%E4%B8%8B%E8%BD%BD%E5%99%A8)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/pngfanjjobjjaacbgmdffbpbhhhpmpab?label=Chrome%20Web%20Store&style=for-the-badge&logo=google-chrome&logoColor=white&color=4285F4)](https://chromewebstore.google.com/detail/pngfanjjobjjaacbgmdffbpbhhhpmpab?utm_source=item-share-cp)
[![Microsoft Edge Add-ons](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fedgeadd-ons.microsoft.com%2Fapi%2Fv1%2Fproducts%2Ffgndinbbbeacfipjpkkbimjphjaljhbg&query=%24.version&prefix=v&label=Microsoft%20Edge&style=for-the-badge&logo=microsoft-edge&logoColor=0078D7&color=0078D7)](https://microsoftedge.microsoft.com/addons/detail/fgndinbbbeacfipjpkkbimjphjaljhbg)

批量下载 **Fantia / pixivFANBOX / Patreon / Pawchive** 作者投稿中的图片、视频、音频、附件与正文网盘链接。

适合想把已订阅、已解锁内容整理到本地的用户：先筛选再下载，支持自定义文件夹与文件名。

> 只能下载你当前账号已经解锁的内容。未解锁内容会被跳过并单独计数。

## 支持站点

| 站点 | 可用页面 |
| --- | --- |
| Fantia | 作者主页、投稿页 |
| pixivFANBOX | 作者主页、投稿页 |
| Patreon | 作者主页、投稿页、合集页 |
| Pawchive | 作者页、投稿页 |

请在对应网站打开面板后再操作。Fantia、Fanbox、Patreon、Pawchive **不能互相跨站代抓**。

## 功能

- 批量抓取作者全部投稿，或只处理当前投稿
- 按投稿日期筛选（JST），并提供近 30 天 / 近 90 天 / 今年等快捷选项
- 按标题关键词包含 / 排除筛选
- 按订阅方案筛选（Fantia / Fanbox / Patreon）
- 按合集筛选（Patreon，含“未合集”）
- 按文件类型筛选：图片、视频、音频、附件、封面、正文、链接
- 自定义保存路径与文件名规则，可用 `/` 建文件夹
- 命名实时预览
- 并发下载、暂停、停止、失败重试
- 跳过已下载文件（按投稿 ID + 文件 ID 记录）
- 复制当前筛选结果的直链与预计保存路径
- 尽量提取正文 / 卡片中的网盘链接；Fanbox 与 Pawchive 的 iframely 卡片会尝试还原真实地址

### 让文件夹结构生效

若希望按自定义规则分文件夹保存，请到 Tampermonkey 设置：

1. 打开 **下载 BETA**
2. 下载模式选择 **浏览器 API**
3. 若视频 / 压缩包提示白名单限制，在「白名单扩展名」中加入对应扩展名，或使用 `/.*/`

同时建议关闭浏览器「下载前询问每个文件的保存位置」，避免每个文件都弹另存为对话框。

## 使用流程

1. 打开作者主页或投稿页，点开 FanLoot 面板
2. 在「① 抓取筛选」填写目标链接，设置日期、关键词、方案、合集、文件类型
3. 点击「开始抓取」，确认摘要无误后进入「② 文件名与下载」
4. 调整文件名规则与并发数，点击「开始下载」

### 文件名变量

可用变量包括：

`{user}` `{date}` `{title}` `{post_id}` `{index}` `{name}` `{plan}` `{price}` `{type}` `{fanclub}` `{fanclub_id}` `{year}` `{month}` `{day}` `{time}` `{content_title}` `{content_id}` `{page}` `{tags}` `{ext}`

默认示例：

```text
Fantia/{user}/{date} {title} ({post_id})/{index}_{name}
Fanbox/{user}/{date} {title} ({post_id})/{index}_{name}
Patreon/{user}/{date} {title} ({post_id})/{index}_{name}
Pawchive/{user}/{date} {title} ({post_id})/{index}_{name}
```

未手动写入 `{ext}` 时，脚本会自动补上扩展名。保存路径相对于浏览器默认下载目录。

`{date}` 的格式可自定义，例如 `YYYY-MM-DD`、`YYYYMMDD`、`YYYY-MM-DD_HH-mm`。

## 注意事项

- 本脚本用于整理你已有权访问的内容；请遵守各平台服务条款与当地法律
- Fantia / Fanbox / Patreon 的下载链接通常有时效，失败较多时请重新抓取
- Pawchive 多为站点直链，一般更稳定
- 部分内容只有在线播放、没有下载地址时，会在结果中单独提示
- 作品很多时，建议将请求间隔设为 **600ms 以上**，降低被限流概率
- 导出链接后请尽快使用；直链可能过期，且 Fantia / Fanbox / Patreon 通常仍需保持登录状态

## 反馈

如果你遇到某个作者页抓不到、某类文件漏下、或命名规则不符合预期，欢迎在脚本页面留言，尽量附上：

- 站点名称
- 页面类型（作者主页 / 投稿页 / 合集页）
- 大致复现步骤
- 面板日志中的关键报错
