import '@src/Popup.css';
import { t } from '@extension/i18n';
import { useStorage, useSystemTheme, withErrorBoundary, withSuspense } from '@extension/shared';
import { readLaterStorage, type SavedPage } from '@extension/storage';
import { cn, ErrorDisplay, LoadingSpinner } from '@extension/ui';
import { useState, useEffect, useMemo, useRef } from 'react';

const Popup = () => {
  const { isLight } = useSystemTheme();
  const readLaterState = useStorage(readLaterStorage);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingTags, setEditingTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [editingNotes, setEditingNotes] = useState('');
  const [deletingPageId, setDeletingPageId] = useState<string | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
  }, []);

  // 获取所有唯一的标签（包括自动标签和用户标签）
  const allTags = useMemo(() => {
    const autoTags = new Set<string>();
    const userTags = new Set<string>();

    readLaterState.pages.forEach(page => {
      page.autoTags.forEach(tag => autoTags.add(tag));
      page.tags.forEach(tag => userTags.add(tag));
    });

    // 返回分类的标签
    return {
      auto: Array.from(autoTags).sort(),
      user: Array.from(userTags).sort(),
      all: Array.from(new Set([...autoTags, ...userTags])).sort()
    };
  }, [readLaterState.pages]);

  // 过滤页面
  const filteredPages = useMemo(() => {
    let pages = readLaterState.pages;

    // 按标签过滤（包括自动标签和用户标签）
    if (selectedFilter !== 'all') {
      pages = pages.filter(page =>
        page.autoTags.includes(selectedFilter) || page.tags.includes(selectedFilter)
      );
    }

    // 按已读/未读过滤（没有访问记录 = 未读）
    if (statusFilter === 'unread') {
      pages = pages.filter(page => !page.visitedAt);
    } else if (statusFilter === 'read') {
      pages = pages.filter(page => !!page.visitedAt);
    }

    // 按搜索查询过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      pages = pages.filter(
        page =>
          page.title.toLowerCase().includes(query) ||
          page.url.toLowerCase().includes(query) ||
          page.tags.some(t => t.toLowerCase().includes(query)) ||
          page.autoTags.some(t => t.toLowerCase().includes(query)) ||
          (page.notes && page.notes.toLowerCase().includes(query)),
      );
    }

    // 排序：保存时间
    return [...pages].sort((a, b) => (sortOrder === 'newest' ? b.savedAt - a.savedAt : a.savedAt - b.savedAt));
  }, [readLaterState.pages, selectedFilter, searchQuery, statusFilter, sortOrder]);

  const unreadCount = useMemo(() => readLaterState.pages.filter(p => !p.visitedAt).length, [readLaterState.pages]);

  // 删除页面 - 第一次点击显示确认，第二次点击真正删除
  const handleDeletePage = async (id: string) => {
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }

    if (deletingPageId === id) {
      // 第二次点击，真正删除
      await readLaterStorage.removePage(id);
      setDeletingPageId(null);
    } else {
      // 第一次点击，显示确认状态；5秒后自动取消（切换到别的条目时会先清掉旧计时）
      setDeletingPageId(id);
      deleteTimerRef.current = setTimeout(() => {
        setDeletingPageId(null);
        deleteTimerRef.current = null;
      }, 5000);
    }
  };

  // 取消删除
  const handleCancelDelete = () => {
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    setDeletingPageId(null);
  };

  // 开始编辑
  const handleStartEdit = (page: SavedPage) => {
    setEditingPageId(page.id);
    setEditingTitle(page.title);
    setEditingTags([...page.tags]);
    setEditingNotes(page.notes || '');
    setNewTag('');
  };

  // 保存编辑
  const handleSaveEdit = async () => {
    if (editingPageId) {
      await readLaterStorage.updatePage(editingPageId, {
        title: editingTitle.trim() || undefined,
        tags: editingTags,
        notes: editingNotes,
      });
      setEditingPageId(null);
    }
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setEditingPageId(null);
    setEditingTags([]);
    setEditingNotes('');
    setEditingTitle('');
    setNewTag('');
  };

  // 添加标签
  const handleAddTag = () => {
    if (newTag.trim() && !editingTags.includes(newTag.trim())) {
      setEditingTags([...editingTags, newTag.trim()]);
      setNewTag('');
    }
  };

  // 移除标签
  const handleRemoveTag = (tag: string) => {
    setEditingTags(editingTags.filter(t => t !== tag));
  };

  // 导出数据
  const handleExport = async () => {
    const data = await readLaterStorage.exportData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `read-later-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 导入数据
  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const text = await file.text();
        try {
          const { added, skipped } = await readLaterStorage.importData(text);
          alert(skipped > 0 ? t('importSummary', [String(added), String(skipped)]) : t('importSuccess'));
        } catch (error) {
          alert(t('importError'));
        }
      }
    };
    input.click();
  };

  // 保存当前页面
  const handleSaveCurrentPage = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await readLaterStorage.savePage({
      url: tab?.url ?? '',
      title: tab?.title ?? '',
      favicon: tab?.favIconUrl,
    });

    if (result === 'duplicate') {
      alert(t('pageAlreadySaved'));
    } else if (result === 'unsupported') {
      alert(t('pageCannotBeSaved'));
    }
  };

  // 打开页面
  const handleOpenPage = (url: string, pageId: string) => {
    chrome.tabs.create({ url });
    readLaterStorage.updatePage(pageId, { visitedAt: Date.now() });
  };

  // 切换已读/未读
  const handleToggleRead = (page: SavedPage) => {
    readLaterStorage.updatePage(page.id, { visitedAt: page.visitedAt ? undefined : Date.now() });
  };

  // 格式化日期
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return t('dateToday');
    if (days === 1) return t('dateYesterday');
    if (days < 7) return t('dateDaysAgo', String(days));
    return date.toLocaleDateString();
  };

  return (
    <div className={cn('read-later-popup', isLight ? 'light-theme' : 'dark-theme')}>
      {/* 头部 - 编辑模式时隐藏 */}
      {!editingPageId && (
        <>
          <div className="popup-header">
            <h1 className="popup-title">📚 {t('extensionName')}</h1>
            <div className="popup-actions">
              <button onClick={handleExport} className="icon-btn" title={t('export')}>
                📤
              </button>
              <button onClick={handleImport} className="icon-btn" title={t('import')}>
                📥
              </button>
            </div>
          </div>

          {/* 保存当前页面按钮 */}
          <div className="save-current-page">
            <button onClick={handleSaveCurrentPage} className="save-page-btn">
              ➕ {t('savePage')}
            </button>
          </div>

          {/* 搜索框 */}
          <div className="search-box">
            <input
              type="text"
              placeholder={t('searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
        </>
      )}

      {/* 已读状态 + 排序 - 编辑模式时隐藏 */}
      {!editingPageId && (
        <div className="status-bar">
          <div className="status-tabs">
            {(
              [
                ['all', `${t('allPages')} (${readLaterState.pages.length})`],
                ['unread', `${t('unread')} (${unreadCount})`],
                ['read', `${t('read')} (${readLaterState.pages.length - unreadCount})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={cn('status-tab', statusFilter === value && 'active')}
                onClick={() => setStatusFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            className="sort-select"
            value={sortOrder}
            onChange={e => setSortOrder(e.target.value as 'newest' | 'oldest')}
            aria-label={t('sortLabel')}
          >
            <option value="newest">{t('sortNewest')}</option>
            <option value="oldest">{t('sortOldest')}</option>
          </select>
        </div>
      )}

      {/* 标签过滤 - 编辑模式时隐藏；默认只显示一行，可展开 */}
      {!editingPageId && allTags.all.length > 0 && (
        <div className="filter-tags-wrap">
          <div className={cn('filter-tags', tagsExpanded && 'expanded')}>
            {selectedFilter !== 'all' && (
              <button className="filter-tag active" onClick={() => setSelectedFilter('all')}>
                ✕ {selectedFilter}
              </button>
            )}
            {allTags.all
              .filter(tag => tag !== selectedFilter)
              .map(tag => (
                <button key={tag} className="filter-tag" onClick={() => setSelectedFilter(tag)}>
                  {tag} ({readLaterState.pages.filter(p => p.autoTags.includes(tag) || p.tags.includes(tag)).length})
                </button>
              ))}
          </div>
          <button className="tags-toggle" onClick={() => setTagsExpanded(v => !v)}>
            {tagsExpanded ? t('showLessTags') : t('showMoreTags')}
          </button>
        </div>
      )}

      {/* 页面列表 */}
      <div className="pages-list">
        {filteredPages.length === 0 && !editingPageId ? (
          <div className="empty-state">
            <p className="empty-title">{t('noPages')}</p>
            <p className="empty-description">{t('noPagesDescription')}</p>
          </div>
        ) : (
          // 编辑模式时只显示正在编辑的页面，否则显示所有过滤后的页面
          (editingPageId
            ? readLaterState.pages.filter(p => p.id === editingPageId)
            : filteredPages
          ).map(page => (
            <div key={page.id} className="page-item">
              {editingPageId === page.id ? (
                // 编辑模式 - 显示所有详细信息
                <div className="page-edit">
                  <div className="page-info">
                    {page.favicon && <img src={page.favicon} className="page-favicon" alt="" />}
                    <div className="page-details">
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={e => setEditingTitle(e.target.value)}
                        placeholder={t('pageTitle')}
                        aria-label={t('pageTitle')}
                        className="title-input"
                      />
                      <div className="page-url">{page.url}</div>
                      <div className="page-meta">
                        <span className="page-date">{formatDate(page.savedAt)}</span>
                        {page.visitedAt && <span className="visited-badge">👁️ {t('visited')}</span>}
                      </div>
                    </div>
                  </div>

                  {/* 自动标签（只读显示） */}
                  {page.autoTags.length > 0 && (
                    <div className="auto-tags-display">
                      <label className="edit-label">{t('autoTags')}:</label>
                      <div className="tags-list">
                        {page.autoTags.map(tag => (
                          <span key={tag} className="tag auto-tag">{tag}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 用户标签编辑 */}
                  <div className="tags-edit">
                    <label className="edit-label">{t('tags')}:</label>
                    <div className="tags-list">
                      {editingTags.map(tag => (
                        <span key={tag} className="tag user-tag">
                          {tag}
                          <button onClick={() => handleRemoveTag(tag)} className="tag-remove">×</button>
                        </span>
                      ))}
                    </div>
                    <div className="tag-input-group">
                      <input
                        type="text"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                        placeholder={t('addTag')}
                        className="tag-input"
                      />
                      <button onClick={handleAddTag} className="tag-add-btn">+</button>
                    </div>
                  </div>

                  {/* 备注编辑 */}
                  <div className="notes-edit">
                    <label className="edit-label">{t('notes')}:</label>
                    <textarea
                      value={editingNotes}
                      onChange={(e) => setEditingNotes(e.target.value)}
                      placeholder={t('addNotes')}
                      className="notes-textarea"
                      rows={3}
                    />
                  </div>

                  {/* 按钮 */}
                  <div className="edit-actions">
                    <button onClick={handleSaveEdit} className="btn btn-primary">{t('save')}</button>
                    <button onClick={handleCancelEdit} className="btn btn-secondary">{t('cancel')}</button>
                  </div>
                </div>
              ) : (
                // 显示模式 - 紧凑列表
                <div className="page-display compact">
                  <div className="page-info" onClick={() => handleOpenPage(page.url, page.id)}>
                    {page.favicon && <img src={page.favicon} className="page-favicon" alt="" />}
                    <div className="page-details">
                      <div className={cn('page-title', !page.visitedAt && 'unread')}>
                        {!page.visitedAt && <span className="unread-dot" aria-label={t('unread')} />}
                        {page.title}
                      </div>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="page-actions">
                    {deletingPageId === page.id ? (
                      <>
                        <button onClick={() => handleDeletePage(page.id)} className="action-btn confirm-delete">
                          {t('confirmDelete')}
                        </button>
                        <button onClick={handleCancelDelete} className="action-btn">
                          {t('cancel')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => handleToggleRead(page)} className="action-btn">
                          {page.visitedAt ? t('markUnread') : t('markRead')}
                        </button>
                        <button onClick={() => handleStartEdit(page)} className="action-btn">{t('edit')}</button>
                        <button onClick={() => handleDeletePage(page.id)} className="action-btn delete">
                          {t('delete')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Popup, <LoadingSpinner />), ErrorDisplay);
