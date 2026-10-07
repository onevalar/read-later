# Read Later 项目进度

## 当前状态（v0.6.0）

核心功能可用，数据层已做过一轮正确性修复。待做事项见文末。

## 已实现

- 保存：右键菜单（页面 / 链接）、快捷键、弹窗按钮；统一过滤（仅 http/https）和按网址去重；结果通过图标角标反馈。
- 自动标签：只看域名，覆盖约 23 个常见站点（YouTube、Vimeo、Bilibili、TikTok、Spotify、SoundCloud、Apple Music、X/Twitter、Facebook、Instagram、Reddit、LinkedIn、GitHub、Stack Overflow、Dev.to、Medium、Amazon、淘宝/天猫、京东、CNN、BBC、NYTimes、Google Docs）及域名含 news 的站点，另外按标题识别教程 / 文章；其余归为 Web Page。
- 标签：自动标签只读；手动标签可增删；筛选栏默认一行，可展开；全部标签由页面实时推导。
- 阅读状态：打开即已读，可手动标已读 / 未读，可按状态筛选。
- 搜索、排序（最新 / 最早在前）、编辑标题 / 标签 / 备注。
- 导入 / 导出：导入校验格式、重新生成编号、按网址去重，提示新增与跳过数量。
- 存储：写入前读取最新数据并在本地排队，避免后台与弹窗同时写时互相覆盖。
- 主题：弹窗和设置页跟随系统；工具栏图标可选跟随系统 / 浅色 / 深色（系统主题在弹窗或设置页打开时上报）。
- 多语言：英文、中文完整；韩文只有基础词条，其余回退英文。

## 数据结构

```ts
interface SavedPage {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  tags: string[];      // 手动标签
  autoTags: string[];  // 自动标签
  savedAt: number;
  visitedAt?: number;  // 有值 = 已读
  notes?: string;
}
```

## 已知限制

- 自动标签的名称（如「🎬 Video」）是存进数据里的，不随界面语言切换。
- 系统主题只在弹窗或设置页打开时同步给工具栏图标，浏览器主题变化后需打开一次才会更新。
- 右键保存链接时拿不到目标页面标题，用网址代替，可在编辑里改。
- 更新自动标签规则不会改动已保存页面的旧标签。

## 待办

- [ ] 按设计稿重做界面
- [ ] 批量操作、文件夹分组
- [ ] 已保存页面标题的后台补全（链接保存场景）
- [ ] 韩文补全
