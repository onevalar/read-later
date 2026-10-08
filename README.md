# Read Later

Chrome 扩展（Manifest V3）和可安装的手机网页阅读库，使用同一份数据模型。
Web 控件使用用户定制的 Hero UI v3 custom（`@onevalar/pro`），统一采用 Linear light/dark。

## 当前状态

2026-10-08：同步实现已改为 Supabase 官方 JavaScript SDK，CloudKit 客户端、登录回调、
专用测试和环境参数已移除。升级时仅删除旧同步凭据/状态与旧闹钟，保留阅读库和本地操作日志。
Apple 开发者后台的旧 App ID/容器不参与新实现；此代码变更不删除账号后台的资源。

Supabase 免费项目、阅读库账号和数据库初始化已完成。线上核对 `reading_operations` 已创建，
RLS 已开启，SELECT/INSERT 只允许 authenticated 账号访问 `auth.uid() = user_id` 的记录。
真实匿名 REST 请求返回 401 / 42501，禁止读取；网页登录成功，新增链接、标题、笔记、
已读/未读变更已写入真实云表，刷新后登录会话保留。
真实手机回写已验收：用户在手机将电脑创建的测试条目标题改为“手机同步成功”，
云表出现对应 title patch，电脑网页同步后显示相同标题。电脑网页 → 手机 → 云端 →
电脑网页的往返链路通过；已安装的 Dia 扩展与网页双向修改笔记的真实联调也已通过。
项目公开连接参数已预置并发布；线上核对加载 `index-DLWRyZpB.js`。
未登录时不会同步阅读数据。33 项自动化测试、3 项类型检查及 13 个构建任务通过。
修复扩展存储改变 JSON 字段顺序时误报 `Conflicting reading-library operation ID` 的问题：
合并和上传确认统一按规范化内容比较，兼容旧云端记录，真正不同的内容仍会拒绝。
无需清空本地数据、重建操作编号或重新登录；Dia 中重新加载现有扩展后已恢复同步，
扩展修改笔记已通过真实云端传到网页，网页回传的新笔记也已在 Dia 扩展确认。
用户已在其他浏览器执行初始化脚本；内置浏览器的 SQL 编辑器加载异常不影响已核对的云表和同步接口。

## 功能

- 右键菜单、快捷键和弹窗保存当前网页；按网址去重，仅接受 http/https 链接。
- 保存后可撤销；已阅读或编辑的内容不会被旧的撤销操作删除。
- 待读/已读、搜索、标签、笔记、删除、JSON 导入导出。
- 尝试从网页 article/main 提取纯文本；提取失败仍保留链接。阅读器支持进度恢复、
  浏览器前进/后退和保存失败提示。没有实现图片或完整网页排版的离线抓取。
- 电脑扩展使用 chrome.storage.local，手机网页使用 IndexedDB。未配置云端或离线时继续本地使用。
- 手机端为 PWA，可在 iPhone Safari 的分享菜单中“添加到主屏幕”。
- 同一个阅读库账号通过 Supabase 同步文章、笔记、进度与删除操作。
  网页打开/恢复网络/返回前台、编辑后和每两分钟触发同步；扩展用后台闹钟重试。
  手机网页关闭后不保证后台同步，重新打开即可同步。

## 第一次配置 Supabase（免费方案）

### 1. 创建项目

1. 在 [Supabase Dashboard](https://supabase.com/dashboard) 注册或登录。
2. 创建 Free 组织/项目，名称 `read-later`，区域选靠近自己常用网络的位置。
3. 自己设置并保存数据库密码。该密码不填进阅读库，也不发给其他人。
4. 等项目准备好后，在 **Connect** 或 **Settings → API Keys** 找到：
   - Project URL：`https://项目编号.supabase.co`
   - Publishable key：`sb_publishable_...`

这两个是客户端公开参数。客户端拒绝 Secret key、service_role 和旧 JWT 密钥。
公开密钥不代替账号登录；阅读数据仍由数据库 RLS 隔离。

### 2. 初始化数据库

在该项目的 **SQL Editor → New query** 中粘贴并执行：

[supabase/migrations/202610080001_reading_operations.sql](supabase/migrations/202610080001_reading_operations.sql)

脚本创建 `reading_operations`，开启并强制 RLS。未登录不能读取；登录后只能读取和追加
自己账号的操作记录。没有授予 UPDATE/DELETE；应用中的删除以不可变删除操作实现。
脚本可重复执行，不会清空阅读内容。不要额外添加允许所有人读取的 policy。

### 3. 创建个人阅读库账号

在 **Authentication → Users → Add user → Create new user**：

1. 输入自己的邮箱和专门用于阅读库的新密码。
2. 如果界面提供 **Auto Confirm User**，勾选它，仅确认这个由你亲自创建的个人账号。
3. 保存。此账号与 Supabase 管理后台登录独立，手机与电脑使用同一份阅读库登录信息。

这是个人使用的初始化方式，不需要关闭整个项目的邮件验证规则，也不需要配置 SMTP。
不要使用 Invite user，因为邀请需要邮件服务。后续开放给其他用户时，再单独设计注册、
邮箱验证与密码找回；Supabase 默认邮件服务只适合受限测试，不能承诺任意邮箱都能收到邮件。
密码只在 Supabase 后台或自己的阅读库页面中输入，不写入代码/聊天/备份。

### 4. 连接电脑与手机

在阅读库 **设置 → 同步服务设置** 填写上述 Project URL 和 Publishable key，并保存。
随后输入阅读库邮箱和密码，点击 **登录并同步**。保存连接设置本身不会上传阅读数据。
第一次登录会把此设备阅读库与该账号合并。另一台设备填入同一项目参数，登录同一账号。

网页部署在 [anvalar-read-later.pages.dev](https://anvalar-read-later.pages.dev)。
当前构建已预置用户确认的 `btetqmmdsugfbyklasuq` 项目公开参数，新设备只需登录账号。
已手动保存的设备配置保留原值，必要时在同步服务设置中更新。
Cloudflare 仍只托管静态网页；阅读内容上传到所选 Supabase 项目。

### 5. 验收（不能只检查登录成功）

- 电脑保存一个测试链接，手机打开后能看到它。
- 手机修改标题/笔记/阅读进度，电脑同步后看到更新。
- 离线修改后重连，改动不丢失；删除操作不会被旧设备的迟到修改恢复。
- 刷新页面无需再次输入密码；过期会话由官方 SDK 刷新，真正失效时才提示登录。
- 两个不同账号不能读取或写入对方数据；未登录请求被拒绝。

免费项目可能因低活跃度被暂停；在后台恢复后重试即可，本地阅读不依赖云端可用性。
不要用空请求人为维持活跃。免费版没有自动数据库备份，保留定期导出阅读库的习惯。

## 同步与数据保护

客户端只使用 Project URL、Publishable key 和用户登录会话。密码不保存；会话仅存于当前
设备的专用存储，不包含在导出文件中。官方 SDK 负责密码登录及会话刷新。
同一浏览器的同步和登录/退出通过 Web Locks 串行执行，避免重复刷新或退出时继续上传。
已绑定的阅读库不能静默换项目或账号，防止将旧账号内容上传给另一个账号。
退出删除本地登录会话、保留阅读库和账号绑定。

保存和字段修改生成不可变操作，按 ID 去重。删除后的迟到普通修改不恢复文章，显式重新保存
才会恢复。上传失败可安全重试，重复插入后会核对 payload，不把冲突记录算作成功。
分页读取全部操作，上传按条数与实际 UTF-8 字节数分批。持续编辑最多连续同步三轮，
未上传的变化保留“等待同步”；不会在一次失败后无限循环。

当前面向个人规模，仍使用全量操作分页读取，尚未实现日志压缩和后台推送。
跨设备导入备份只按网址添加新链接，不覆盖已有链接；不是自动同步的替代实现。

## 开发与验证

需要 Node.js 22.15.1 或更高版本。

```sh
pnpm install --frozen-lockfile
pnpm exec tsx --test tests/*.test.ts
pnpm exec turbo type-check --filter=@extension/storage --filter=@extension/ui --filter=@extension/library --concurrency=2
pnpm exec turbo build --filter=@extension/library --filter=chrome-extension --filter=@extension/options --filter=@extension/popup --concurrency=2
```

扩展产物在 `dist/`，从 chrome://extensions 加载已解压扩展。网页在 `web-dist/`。
Cloudflare Pages 上传仅包含 web-dist 的静态文件，不上传阅读记录、数据库密码或用户会话。
已有 vercel.json 和网页 _headers；哈希资源长期缓存，首页和 Service Worker 重新验证更新。
本地预览只监听 `127.0.0.1:5181`，不要绕过工作区的开发服务安全保护。

测试覆盖本地保存、撤销、离线壳、操作合并、SDK 登录/刷新、分页、分批重试、账号边界，
以及使用 PGlite 执行实际 PostgreSQL RLS 脚本的两账号和匿名权限测试。
这些自动化测试使用虚拟用户和本地数据，不能替代真实项目的双端验收。

参考：[Supabase SDK](https://supabase.com/docs/reference/javascript/initializing)、
[密码登录](https://supabase.com/docs/guides/auth/passwords)、
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、
[公开密钥](https://supabase.com/docs/guides/getting-started/api-keys)。
