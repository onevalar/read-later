# Read Later 扩展 - 项目进度文档

## 项目概述

这是一个 Chrome 扩展，用于保存网页以便稍后阅读。具有智能自动分类、标签管理、搜索等功能。

**核心特性：**
- 智能自动分类（基于 URL 识别 40+ 网站）
- 用户手动标签管理
- 搜索功能
- 导入/导出数据
- 中英文双语支持
- 浅色/深色主题自动切换
- 紧凑列表 UI

## 技术栈

- **框架**: React + TypeScript
- **构建工具**: Vite + Turbo (monorepo)
- **扩展标准**: Chrome Extension Manifest V3
- **存储**: Chrome Storage API (本地存储)
- **国际化**: chrome.i18n

## 项目结构

```
read_later/
├── chrome-extension/
│   ├── manifest.ts                # 扩展配置（权限、快捷键等）
│   └── src/background/index.ts   # 后台脚本（右键菜单、保存逻辑）
├── pages/
│   └── popup/
│       ├── src/Popup.tsx          # 主 UI 组件
│       ├── src/Popup.css          # UI 样式
│       └── src/index.css          # 基础尺寸（600x600）
├── packages/
│   ├── storage/
│   │   └── lib/impl/read-later-storage.ts  # 数据模型和智能分类逻辑
│   └── i18n/
│       └── locales/
│           ├── en/messages.json   # 英文翻译
│           └── zh/messages.json   # 中文翻译
└── dist/                          # 构建输出目录
```

## 已完成功能

### 1. 核心功能 ✅
- [x] 保存当前页面（三种方式）
  - 右键菜单："Save to Read Later"
  - 快捷键：Ctrl+Shift+S (Mac: Command+Shift+S)
  - Popup 内的"保存页面"按钮
- [x] 保存链接（右键点击链接时）
- [x] 过滤特殊页面（chrome://、about:// 等）
- [x] 防重复保存检测
- [x] 删除页面（二次确认机制）
- [x] 点击标题打开页面
- [x] 记录访问状态

### 2. 智能分类 ✅
自动识别并标记以下类型和来源：

**内容类型：**
- 🎬 Video（视频）
- 🎵 Audio（音频）
- 📰 News（新闻）
- 📝 Article（文章）
- 💻 Code（代码）
- 🛍️ Shopping（购物）
- 📄 PDF（PDF 文档）

**网站来源：** 40+ 网站
- 视频：YouTube, Bilibili, Vimeo, TikTok, Douyin
- 音频：Spotify, SoundCloud, Apple Music, 网易云音乐, QQ音乐
- 社交：X/Twitter, Facebook, Instagram, LinkedIn, Reddit, 微博, 知乎, 小红书
- 开发：GitHub, GitLab, Stack Overflow, Dev.to, Medium, 掘金, CSDN
- 购物：Amazon, 淘宝, 京东, 拼多多
- 新闻：各大新闻网站
- 文档：Google Docs, Notion, Wikipedia
- 其他：Netflix, Hulu, Disney+, Twitch 等

**实现位置：** `packages/storage/lib/impl/read-later-storage.ts` 中的 `generateAutoTags()` 函数

### 3. 标签系统 ✅
- [x] 自动标签（只读，系统生成）
- [x] 用户标签（可编辑）
- [x] 标签筛选（包含自动标签和用户标签）
- [x] 添加/删除标签功能
- [x] 标签数量统计

### 4. 搜索功能 ✅
搜索范围包括：
- 页面标题
- URL
- 用户标签
- 自动标签
- 备注内容

### 5. 数据管理 ✅
- [x] 导出数据（JSON 格式）
- [x] 导入数据
- [x] 本地存储（Chrome Storage API）

### 6. UI 优化 ✅

**紧凑列表模式：**
- 默认只显示：Favicon + 标题 + 编辑/删除按钮
- 减少 70% 垂直空间占用
- 一屏可显示 8-10 条内容（之前只能 2-3 条）

**编辑专注模式：**
- 点击"编辑"后隐藏所有其他内容
- 只显示正在编辑的页面
- 隐藏：头部、搜索框、标签筛选、其他页面项

**主题支持：**
- 自动跟随系统浅色/深色主题
- 完整的主题色适配

### 7. 多语言支持 ✅
- [x] 中文（zh）
- [x] 英文（en）
- [x] 所有 UI 文本已翻译

## 数据结构

### SavedPage 接口
```typescript
interface SavedPage {
  id: string;           // 唯一标识
  url: string;          // 页面 URL
  title: string;        // 页面标题
  favicon?: string;     // 网站图标
  tags: string[];       // 用户添加的标签
  autoTags: string[];   // 自动生成的标签
  savedAt: number;      // 保存时间戳
  visitedAt?: number;   // 访问时间戳
  notes?: string;       // 备注
}
```

## 关键文件说明

### 1. `chrome-extension/src/background/index.ts`
后台服务脚本，负责：
- 监听右键菜单点击
- 监听快捷键
- 处理页面保存逻辑
- 错误处理（已用 try-catch 包裹）

**重要修复：**
- ✅ 移除了 notification 功能（避免权限错误）
- ✅ 用 try-catch 包裹所有事件监听器
- ✅ 使用 .then().catch() 而非 async/await（避免编译错误）

### 2. `pages/popup/src/Popup.tsx`
主 UI 组件，核心逻辑：
- `allTags`: 计算所有唯一标签（自动 + 用户）
- `filteredPages`: 根据搜索和标签筛选页面
- `editingPageId`: 控制编辑模式和专注视图
- 编辑模式时只渲染被编辑的页面

### 3. `pages/popup/src/Popup.css`
样式文件，关键类：
- `.page-display.compact`: 紧凑列表样式
- `.page-item:has(.page-edit)`: 编辑模式下增加内边距
- `.page-edit`: 编辑面板样式
- 完整的 light/dark 主题支持

### 4. `packages/storage/lib/impl/read-later-storage.ts`
存储层，包含：
- `generateAutoTags()`: 智能分类逻辑（40+ 网站识别）
- `addPage()`: 添加页面
- `removePage()`: 删除页面
- `updatePage()`: 更新页面（标签、备注等）
- `exportData()` / `importData()`: 数据导入导出

## 已知问题与修复历史

### 已修复 ✅
1. **UI 显示不全** - 将 body 宽度从 300px 改为 600px
2. **删除功能问题** - 实现二次确认机制（点击两次）
3. **通知权限错误** - 完全移除 notification 功能，只使用 console.log
4. **右键菜单错误** - 重构代码，添加 try-catch，改用 .then().catch() 模式
5. **标签筛选不完整** - 现在包含用户手动标签
6. **编辑时界面混乱** - 实现专注模式，隐藏其他元素

## 待优化事项

### UI/UX 改进
- [ ] **按照用户提供的设计稿重新设计界面**（下一步）
  - 用户将提供新的 UI 设计稿
  - 需要精确还原设计细节（颜色、间距、圆角等）

### 可能的功能增强（可选）
- [ ] 添加排序功能（按时间、标题等）
- [ ] 添加阅读进度标记
- [ ] 支持文件夹分组
- [ ] 支持多选批量操作
- [ ] 添加键盘快捷键导航

## 构建与测试

### 构建命令
```bash
pnpm build
```

### 加载扩展
1. 打开 `chrome://extensions/`
2. 启用"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `read_later/dist` 目录

### 重新加载
修改代码后重新构建，然后在扩展管理页面点击刷新按钮 🔄

## 下一步计划

1. **等待用户提供 UI 设计稿**
2. 根据设计稿精确还原界面
3. 测试新 UI 的所有交互细节
4. 优化性能（如果需要）

## 开发提示

### 修改 UI
- 主要文件：`pages/popup/src/Popup.tsx` 和 `Popup.css`
- 记得同时适配浅色和深色主题

### 修改分类逻辑
- 文件：`packages/storage/lib/impl/read-later-storage.ts`
- 函数：`generateAutoTags(url: string, title: string)`

### 添加新的翻译
- 英文：`packages/i18n/locales/en/messages.json`
- 中文：`packages/i18n/locales/zh/messages.json`

### 修改权限或快捷键
- 文件：`chrome-extension/manifest.ts`

---

**最后更新时间：** 2025-10-29
**当前版本：** 0.6.0
**状态：** ✅ 核心功能完成，等待 UI 设计稿优化
