// viewer.js - 请求记录查看器的逻辑

class XHRViewer {
  constructor() {
    this.requests = [];
    this.currentTabId = null;
    this.init();
  }

  init() {
    // 绑定事件监听器
    document.getElementById('refreshBtn').addEventListener('click', () => this.loadRequests());
    document.getElementById('copyAllBtn').addEventListener('click', () => this.copyAllRequests());
    document.getElementById('clearBtn').addEventListener('click', () => this.clearAllRequests());

    // 加载请求数据
    this.loadRequests();
  }

  async loadRequests() {
    try {
      this.updateStatus('加载中...');

      const urlParams = new URLSearchParams(window.location.search);
      const tabId = urlParams.get('tabId');
      this.currentTabId = tabId;

      if (tabId) {
        const tabTitle = decodeURIComponent(urlParams.get('tabTitle') || '未知标题');
        const pageTitleEl = document.getElementById('pageTitle');
        
        pageTitleEl.textContent = `来自标签页: ${tabTitle}`;
        pageTitleEl.title = `点击切换到来源标签页: ${tabTitle}`; // 设置悬浮提示
        pageTitleEl.classList.add('clickable');

        // 添加点击事件监听器
        pageTitleEl.addEventListener('click', async () => {
          try {
            // 获取目标标签页的信息，主要是为了拿到它的窗口ID
            const tab = await chrome.tabs.get(parseInt(tabId, 10));
            // 激活标签页
            await chrome.tabs.update(tab.id, { active: true });
            // 聚焦该标签页所在的窗口
            await chrome.windows.update(tab.windowId, { focused: true });
          } catch (error) {
            console.log('[MENG 错误] 切换标签页失败 (可能已关闭):', error);
            // 可以给用户一个提示
            pageTitleEl.textContent = `(已关闭) ${pageTitleEl.textContent}`;
            pageTitleEl.classList.remove('clickable');
            pageTitleEl.title = '来源标签页已关闭';
          }
        });

        // 如果URL中提供了 tabId，则加载特定标签页的数据
        console.log(`[MENG 日志] 准备加载标签页 ${tabId} (${tabTitle}) 的请求记录`);
        const result = await chrome.storage.local.get([tabId]);
        this.requests = result[tabId] || [];
        this.renderRequests();
        this.updateStatus(`已加载 ${this.requests.length} 条记录 (ID: ${tabId})`);
        document.getElementById('clearBtn').disabled = false;
      } else {
        // 否则，加载所有标签页的数据作为后备
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
        const clearBtn = document.getElementById('clearBtn');
        clearBtn.disabled = true;
        clearBtn.title = '无法在"所有标签页"模式下清空';
      }

    } catch (error) {
      console.log('[MENG 错误] 加载请求记录失败:', error);
      this.updateStatus('加载失败');
      this.renderError('加载请求记录时发生错误');
    }
  }

  renderRequests() {
    const container = document.getElementById('requestList');

    if (this.requests.length === 0) {
      container.innerHTML = `
                <div class="empty-state">
                    <p>暂无请求记录</p>
                    <p>请在要监听的页面上点击"开始监听"按钮</p>
                </div>
            `;
      return;
    }

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
      
      const { url, id: requestId, timestamp, ...rest } = request;

      // 处理非JSON响应
      if (rest.res && rest.res.__isNonJson) {
        rest.res = rest.res.__originalText;
      }

      const orderedRequest = { url, ...rest };
      const requestText = JSON.stringify(orderedRequest, null, 2);
      await navigator.clipboard.writeText(requestText);
      this.showToast('单条记录已复制');
    } catch (error) {
      console.log('[MENG 错误] 复制记录失败:', error);
      this.showToast('复制失败');
    }
  }

  async copyAllRequests() {
    try {
      if (this.requests.length === 0) {
        this.showToast('没有可复制的记录');
        return;
      }

      // 按时间倒序排序
      const sortedRequests = [...this.requests].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      const orderedRequests = sortedRequests.map(request => {
        const { url, id, timestamp, ...rest } = request;
        
        if (rest.res && rest.res.__isNonJson) {
          rest.res = rest.res.__originalText;
        }

        return { url, ...rest };
      });
      const allRequestsText = JSON.stringify(orderedRequests, null, 2);
      await navigator.clipboard.writeText(allRequestsText);
      this.showToast(`已复制 ${this.requests.length} 条记录`);
    } catch (error) {
      console.log('[MENG 错误] 复制全部记录失败:', error);
      this.showToast('复制失败');
    }
  }

  async clearAllRequests() {
    if (!this.currentTabId) {
      this.showToast('没有指定要清除的标签页');
      return;
    }

    try {
      // 清空当前标签页的记录
      await chrome.storage.local.remove([this.currentTabId]);

      // 通知 content script 更新状态
      try {
        await chrome.tabs.sendMessage(parseInt(this.currentTabId, 10), { action: 'clearRecords' });
      } catch (e) {
        console.log('[MENG 错误] 通知 content script 失败 (标签页可能已关闭):', e);
      }

      this.requests = [];
      this.renderRequests();
      this.updateStatus('记录已清空');
      this.showToast('所有记录已清空');
    } catch (error) {
      console.log('[MENG 错误] 清空记录失败:', error);
      this.showToast('清空失败');
    }
  }

  renderError(message) {
    const container = document.getElementById('requestList');
    container.innerHTML = `
            <div class="empty-state">
                <p>❌ ${message}</p>
                <button onclick="location.reload()">重试</button>
            </div>
        `;
  }

  updateStatus(text) {
    document.getElementById('status').textContent = text;
  }

  showToast(message) {
    // 立即清空上一个 toast
    const lastToast = document.querySelector('.toast');
    if (lastToast) {
      lastToast.remove();
    }

    // 创建临时提示元素
    const toast = document.createElement('div');
    toast.classList.add('toast');
    toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.5);
            color: white;
            padding: 8px 16px;
            border-radius: 4px;
            z-index: 10000;
            animation: slideIn 0.15s ease;
        `;
    toast.textContent = message;

    // 添加动画样式
    const style = document.createElement('style');
    style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
    document.head.appendChild(style);

    document.body.appendChild(toast);

    // 3 秒后移除
    setTimeout(() => {
      toast.remove();
      style.remove();
    }, 2000);
  }
}

// 初始化查看器
document.addEventListener('DOMContentLoaded', () => {
  new XHRViewer();
});