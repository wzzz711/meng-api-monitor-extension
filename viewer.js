// viewer.js - 请求记录查看器的逻辑

class XHRViewer {
  constructor() {
    this.requests = [];
    this.currentTabId = null;
    this.pageTitleInitialized = false; // 防止重复初始化页面标题和事件
    this.isAutoRefreshEnabled = false; // 默认关闭
    this.toastTimer = null; // 用于管理 toast 的定时器
    this.init();
  }

  init() {
    // 确保在 DOM 完全加载后再执行所有操作
    document.addEventListener('DOMContentLoaded', () => this.run());
  }

  run() {
    // 绑定固定的 UI 元素事件
    document.getElementById('refreshBtn').addEventListener('click', () => this.loadRequests());
    document.getElementById('copyAllBtn').addEventListener('click', () => this.copyAllRequests());
    document.getElementById('autoRefreshToggle').addEventListener('change', (e) => this.handleAutoRefreshToggle(e));

    // 监听 storage 变化，实现列表自动刷新
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !this.currentTabId || !changes[this.currentTabId.toString()]) {
        return;
      }

      const change = changes[this.currentTabId.toString()];
      const isCleared = typeof change.newValue === 'undefined';

      // 如果是清空操作，则无视开关，必须刷新
      if (isCleared) {
        console.log('[MENG 日志] 检测到记录被清空，强制刷新UI...');
        this.loadRequests();
        return;
      }

      // 如果是数据更新（非清空），则遵循自动刷新开关的设置
      if (this.isAutoRefreshEnabled) {
        console.log(`[MENG 日志] 检测到数据变更且自动刷新已开启，正在刷新...`);
        this.loadRequests();
      }
    });

    // 监听来自 background 的主动推送消息（如标题更新）
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'titleUpdated' && this.currentTabId && message.tabId.toString() === this.currentTabId) {
        console.log(`[MENG 日志] 收到标题更新推送，新标题: "${message.newTitle}"`);
        this.updatePageTitle(message.newTitle);
      }
    });

    // 加载用户偏好并首次加载数据
    this.loadAutoRefreshState().then(() => {
      this.updateRefreshControlsUI(); // 根据加载的状态更新 UI
      this.loadRequests();
    });
  }

  // 根据状态更新刷新控件的 UI
  updateRefreshControlsUI() {
    const refreshBtn = document.getElementById('refreshBtn');
    if (!refreshBtn) return;

    if (this.isAutoRefreshEnabled) {
      refreshBtn.disabled = true;
      refreshBtn.textContent = '自动刷新';
      refreshBtn.title = '自动刷新已开启，无需手动操作';
      refreshBtn.classList.add('is-auto-refreshing');
    } else {
      refreshBtn.disabled = false;
      refreshBtn.textContent = '刷新';
      refreshBtn.title = '手动刷新记录';
      refreshBtn.classList.remove('is-auto-refreshing');
    }
  }

  // 处理自动刷新开关的切换
  handleAutoRefreshToggle(event) {
    this.isAutoRefreshEnabled = event.target.checked;
    this.updateRefreshControlsUI(); // 状态改变后，立即更新 UI
    this.saveAutoRefreshState();
    this.showToast(`自动刷新已${this.isAutoRefreshEnabled ? '开启' : '关闭'}`);

    // 如果是开启自动刷新，则立即执行一次刷新
    if (this.isAutoRefreshEnabled) {
      console.log('[MENG 日志] 自动刷新已开启，立即刷新一次获取最新数据...');
      this.loadRequests();
    }
  }

  // 从 storage 加载自动刷新的状态
  async loadAutoRefreshState() {
    try {
      const key = 'autoRefreshState';
      const result = await chrome.storage.local.get([key]);
      // 默认为 true，除非明确存储为 false
      this.isAutoRefreshEnabled = result[key] !== false;
      const toggle = document.getElementById('autoRefreshToggle');
      if (toggle) {
        toggle.checked = this.isAutoRefreshEnabled;
      }
    } catch (error) {
      console.log('[MENG 错误] 加载自动刷新状态失败:', error);
      // 在出错时保持默认值
      this.isAutoRefreshEnabled = false;
    }
  }

  // 保存自动刷新的状态到 storage
  async saveAutoRefreshState() {
    try {
      await chrome.storage.local.set({
        'autoRefreshState': this.isAutoRefreshEnabled
      });
    } catch (error) {
      console.log('[MENG 错误] 保存自动刷新状态失败:', error);
    }
  }

  async loadRequests() {
    // 在开始加载前，先清除所有即时状态，比如toast
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      document.querySelector('.toast')?.classList.remove('show');
    }

    try {
      this.updateStatus('加载中...');

      const urlParams = new URLSearchParams(window.location.search);
      const tabId = urlParams.get('tabId');

      // 首次加载时设置当前 tabId
      if (!this.currentTabId) {
        this.currentTabId = tabId;
      }

      if (this.currentTabId) {
        // 只有在首次加载时才设置标题和点击事件，避免重复绑定
        if (!this.pageTitleInitialized) {
          this.initializePageHeader(this.currentTabId);
        }

        console.log(`[MENG 日志] 准备加载标签页 ${this.currentTabId} 的请求记录`);
        const result = await chrome.storage.local.get([this.currentTabId]);
        this.requests = result[this.currentTabId] || [];
        this.renderRequests();
        this.updateStatus(`已加载 ${this.requests.length} 条记录 (ID: ${this.currentTabId})`);
      } else {
        // 如果没有提供 tabId
        document.getElementById('pageTitle').textContent = '所有标签页的请求记录';
        console.log('[MENG 日志] 未提供 tabId，加载所有标签页的记录');
        const allData = await chrome.storage.local.get(null);
        let allRequests = [];
        Object.keys(allData).forEach(key => {
          if (Array.isArray(allData[key])) {
            allRequests = allRequests.concat(allData[key]);
          }
        });
        this.requests = allRequests;
        this.renderRequests();
        this.updateStatus(`已加载 ${this.requests.length} 条记录 (来自所有标签页)`);
      }

    } catch (error) {
      console.log('[MENG 错误] 加载请求记录失败:', error);
      this.updateStatus('加载失败');
      this.renderError('加载请求记录时发生错误');
    }
  }

  initializePageHeader(tabId) {
    const urlParams = new URLSearchParams(window.location.search);
    const initialTitle = decodeURIComponent(urlParams.get('tabTitle') || '未知标题');
    this.updatePageTitle(initialTitle); // 使用一个统一的函数来更新标题

    // 立即向 background 请求最新的标题
    chrome.runtime.sendMessage({ action: 'getTabTitle', tabId: parseInt(tabId, 10) }, (response) => {
      if (response && response.success) {
        this.updatePageTitle(response.title);
      } else {
        console.log('[MENG 警告] 获取最新标签页标题失败:', response?.error || '未知错误');
      }
    });

    const pageTitleEl = document.getElementById('pageTitle');
    pageTitleEl.classList.add('clickable');

    pageTitleEl.addEventListener('click', async () => {
      try {
        const tab = await chrome.tabs.get(parseInt(tabId, 10));
        await chrome.tabs.update(tab.id, {
          active: true
        });
        await chrome.windows.update(tab.windowId, {
          focused: true
        });
      } catch (error) {
        console.log('[MENG 错误] 切换标签页失败 (可能已关闭):', error);
        // 获取最新的标题来更新UI
        const currentTitle = pageTitleEl.textContent.replace('来自标签页: ', '').replace(/^\(已关闭\) /, '');
        pageTitleEl.textContent = `(已关闭) ${currentTitle}`;
        pageTitleEl.classList.remove('clickable');
        pageTitleEl.title = '来源标签页已关闭';
      }
    });

    this.pageTitleInitialized = true; // 标记为已初始化
  }

  // 统一更新页面标题的函数
  updatePageTitle(newTitle) {
    const pageTitleEl = document.getElementById('pageTitle');
    if (pageTitleEl && !pageTitleEl.textContent.includes('(已关闭)')) {
      pageTitleEl.textContent = `来自标签页: ${newTitle}`;
      // 更新悬浮提示，但要保留 "点击切换" 的部分
      pageTitleEl.title = `点击切换到来源标签页: ${newTitle}`;
    }
  }

  renderRequests() {
    const container = document.getElementById('requestList');

    if (!container) return; // DOM还没准备好

    if (this.requests.length === 0) {
      container.innerHTML = `
                <div class="empty-state">
                    <p>暂无请求记录</p>
                    <p>请在要监听的页面上点击"开始监听"按钮，以便捕获请求</p>
                </div>
            `;
      document.getElementById('copyAllBtn').disabled = true;
      return;
    }

    document.getElementById('copyAllBtn').disabled = false;

    // 按时间倒序排列
    const sortedRequests = [...this.requests].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    container.innerHTML = sortedRequests.map((request, index) =>
      this.renderRequestItem(request, index)
    ).join('');

    // 绑定事件监听器
    this.bindRequestEvents();
  }

  renderRequestItem(request, index) {
    const timestamp = request.timestamp ? new Date(request.timestamp).toLocaleString() : '未知时间';
    const paramsStr = JSON.stringify(request.params || {}, null, 2);

    let responseStr;
    let responseContent;

    if (request.res && request.res.__isNonJson) {
      responseContent = `<div class="detail-content non-json">数据非 JSON 格式，请复制记录查看</div>`;
    } else {
      responseStr = JSON.stringify(request.res || {}, null, 2);
      responseContent = `<div class="detail-content">${responseStr}</div>`;
    }

    return `
      <div class="request-item" data-id="${request.id}">
        <div class="request-header-wrapper">
          <div class="request-header">
            <div class="method-url">
              <span class="expand-icon"></span>
              <span class="method ${request.method || 'GET'}">${request.method || 'GET'}</span>
              <span class="url" title="${request.url}">${request.url}</span>
            </div>
            <div class="request-actions">
              <button class="copy-res-btn" data-id="${request.id}" title="仅复制响应数据">仅复制响应</button>
              <button class="copy-btn" data-id="${request.id}" title="复制完整记录">复制记录</button>
            </div>
          </div>
          <div class="timestamp">${timestamp}</div>
        </div>
        <div class="request-details" style="display: none;">
          <div class="detail-section">
            <div class="detail-title">请求URL</div>
            <div class="detail-content">${request.url}</div>
          </div>
          <div class="detail-section">
            <div class="detail-title">请求参数</div>
            <div class="detail-content">${paramsStr}</div>
          </div>
          <div class="detail-section">
            <div class="detail-title">响应数据</div>
            ${responseContent}
          </div>
        </div>
      </div>
    `;
  }

  bindRequestEvents() {
    // 绑定复制按钮事件
    document.querySelectorAll('.copy-btn, .copy-res-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // 阻止事件冒泡到父元素
        const id = e.currentTarget.dataset.id;
        if (e.currentTarget.classList.contains('copy-btn')) {
          this.copySingleRequest(id);
        } else {
          this.copyResponseOnly(id);
        }
      });
    });

    // 绑定行点击展开/收起事件
    document.querySelectorAll('.request-header-wrapper').forEach(item => {
      item.addEventListener('click', (e) => {
        // 如果点击的是按钮区域，则不触发折叠/展开
        if (e.target.closest('.request-actions')) {
          return;
        }
        const requestItem = item.closest('.request-item');
        if (requestItem) {
          const id = requestItem.dataset.id;
          this.toggleRequestDetails(id);
        }
      });
    });
  }

  toggleRequestDetails(id) {
    const requestItem = document.querySelector(`.request-item[data-id="${id}"]`);
    if (!requestItem) return;

    const detailsElement = requestItem.querySelector('.request-details');
    const icon = requestItem.querySelector('.expand-icon');

    const isExpanded = detailsElement.style.display === 'block';

    detailsElement.style.display = isExpanded ? 'none' : 'block';
    icon.classList.toggle('expanded', !isExpanded);
  }

  async copyResponseOnly(id) {
    try {
      const request = this.requests.find(r => r.id === id);
      if (!request) {
        this.showToast('错误：找不到该记录');
        return;
      }

      let responseText;

      if (request.res && request.res.__isNonJson) {
        responseText = request.res.__originalText;
      } else {
        responseText = JSON.stringify(request.res, null, 2);
      }

      await navigator.clipboard.writeText(responseText);
      this.showToast('响应数据已复制');
    } catch (error) {
      console.log('[MENG 错误] 复制响应失败:', error);
      this.showToast('复制响应失败');
    }
  }

  async copySingleRequest(id) {
    try {
      const request = this.requests.find(r => r.id === id);
      if (!request) {
        this.showToast('找不到该记录');
        return;
      }

      const {
        url,
        id: requestId,
        timestamp,
        ...rest
      } = request;

      // 处理非JSON响应
      if (rest.res && rest.res.__isNonJson) {
        rest.res = rest.res.__originalText;
      }

      const orderedRequest = {
        url,
        ...rest
      };
      const requestText = JSON.stringify(orderedRequest, null, 2);
      await navigator.clipboard.writeText(requestText);
      this.showToast('单条记录已复制');
    } catch (error) {
      console.log('[MENG 错误] 复制记录失败:', error);
      this.showToast('复制失败');
    }
  }

  async copyAllRequests() {
    if (this.requests.length === 0) {
      this.showToast('没有可复制的记录');
      return;
    }

    try {
      const simplifiedRequests = this.requests.map(req => {
        const {
          url,
          id,
          timestamp,
          ...rest
        } = req;
        // 处理非JSON响应
        if (rest.res && rest.res.__isNonJson) {
          rest.res = rest.res.__originalText;
        }
        return {
          url,
          ...rest
        };
      });

      const allRequestsText = JSON.stringify(simplifiedRequests, null, 2);
      await navigator.clipboard.writeText(allRequestsText);
      this.showToast(`全部 ${this.requests.length} 条记录已复制`);
    } catch (error) {
      console.log('[MENG 错误] 复制全部记录失败:', error);
      this.showToast('复制全部记录失败');
    }
  }

  renderError(message) {
    const container = document.getElementById('requestList');
    if (!container) return;
    container.innerHTML = `<div class="empty-state error"><p>${message}</p></div>`;
  }

  updateStatus(text) {
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.textContent = text;
    }
  }

  showToast(message) {
    const toast = document.querySelector('.toast');
    if (!toast) return;
  
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
  
    // 立即清除现有动画状态
    toast.classList.remove('show');
    toast.style.transition = 'none';
    // 触发 reflow，强制浏览器应用上面的 transition:none
    void toast.offsetHeight;
  
    toast.textContent = message;
    toast.style.transition = 'transform 0.15s ease, opacity 0.15s ease';
  
    requestAnimationFrame(() => {
      toast.classList.add('show');
      this.toastTimer = setTimeout(() => {
        toast.classList.remove('show');
      }, 2000);
    });
  }
  
}

// 初始化查看器
new XHRViewer();