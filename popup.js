// popup.js - 弹出窗口的交互逻辑

class XHRMonitorPopup {
  constructor() {
    this.isListening = false;
    this.requestCount = 0;
    this.currentTab = null;
    this.init();
  }

  async init() {
    try {
      // 获取当前标签页
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0]) {
        document.body.innerHTML = '无法在当前页面使用此插件。';
        return;
      }
      this.currentTab = tabs[0];
      console.log('[MENG 日志] 当前标签页:', this.currentTab?.id);

      // 绑定事件监听器
      document.getElementById('startBtn').addEventListener('click', () => this.startListening());
      document.getElementById('stopBtn').addEventListener('click', () => this.stopListening());
      document.getElementById('viewBtn').addEventListener('click', () => this.viewRequests());
      document.getElementById('clearBtn').addEventListener('click', () => this.clearRecords());

      // 监听来自后台的消息，用于实时更新计数
      chrome.runtime.onMessage.addListener((message, sender) => {
        // 确保是针对当前标签页的更新
        // 后台脚本发来的消息没有 sender.tab
        if (message.action === 'updateCount' && message.tabId === this.currentTab.id) {
          console.log(`[MENG 日志] Popup 接收到计数更新: ${message.count}`);
          this.updateCount(message.count);
        }
      });

      // 初始化状态
      await this.loadCurrentStatus();

    } catch (error) {
      console.log('[MENG 错误] 初始化 popup 失败:', error);
      this.showStatus('初始化失败', 'error');
    }
  }

  // 直接从 background 加载状态
  async loadCurrentStatus() {
    try {
      if (!this.currentTab) return;

      const response = await chrome.runtime.sendMessage({
        action: 'getPopupState',
        tabId: this.currentTab.id
      });

      if (response && response.success) {
        this.isListening = response.isListening;
        this.requestCount = response.requestCount;
        console.log('[MENG 日志] 从后台加载当前状态:', response);
      } else {
        console.log('[MENG 错误] 从后台加载状态失败:', response?.error);
        this.isListening = false;
        this.requestCount = 0;
      }
    } catch (error) {
      console.log('[MENG 错误] 无法从后台获取当前状态:', error);
      this.isListening = false;
      this.requestCount = 0;
    } finally {
      this.updateUI();
    }
  }

  async startListening() {
    try {
      if (!this.currentTab) {
        this.showStatus('无法获取当前标签页');
        return;
      }

      await chrome.storage.local.set({ [`state_${this.currentTab.id}`]: true });

      await chrome.tabs.sendMessage(this.currentTab.id, {
        action: 'startListening'
      });

      this.isListening = true;
      this.updateUI();
      this.showStatus('正在监听...', 'success');

    } catch (error) {
      console.log('[MENG 错误] 开始监听失败:', error);
      this.isListening = false;
      this.updateUI();
      this.showStatus('刷新页面后才能开始监听', 'error');
    }
  }

  async stopListening() {
    try {
      if (!this.currentTab) return;

      // 从后台移除状态
      await chrome.storage.local.remove([`state_${this.currentTab.id}`]);

      // 通知 content script 停止工作
      await chrome.tabs.sendMessage(this.currentTab.id, {
        action: 'stopListening'
      });

      this.isListening = false;
      this.updateUI();
      this.showStatus('已停止监听', 'info');
    } catch (error) {
      console.log('[MENG 错误] 停止监听失败:', error);
      this.showStatus('刷新页面后才能停止监听', 'error');
    }
  }

  updateUI() {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const statusEl = document.getElementById('status');
    const countEl = document.getElementById('count');

    countEl.textContent = this.requestCount;

    if (this.isListening) {
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
      statusEl.textContent = '正在监听...';
      statusEl.style.color = '#4CAF50';
    } else {
      startBtn.style.display = 'block';
      stopBtn.style.display = 'none';
      statusEl.textContent = '未监听';
      statusEl.style.color = '#666';
    }
  }

  updateCount(count) {
    this.requestCount = count;
    document.getElementById('count').textContent = count;
  }

  async clearRecords() {
    try {
      if (!this.currentTab) return;

      const tabId = this.currentTab.id.toString();

      await chrome.storage.local.remove([tabId]);
      
      this.updateCount(0);
      this.showStatus('记录已清空', 'success');

      await chrome.tabs.sendMessage(this.currentTab.id, { action: 'clearRecords' });

    } catch (error) {
      console.log('[MENG 错误] 清空记录失败:', error);
      this.showStatus('清空记录失败', 'error');
    }
  }

  async viewRequests() {
    try {
      if (!this.currentTab) return;

      // 请求后台脚本打开查看器页面，并附带明确的参数
      await chrome.runtime.sendMessage({
        action: 'openViewer',
        tabId: this.currentTab.id,
        tabTitle: this.currentTab.title
      });
      console.log('[MENG 日志] 已请求后台打开查看页面, 用于查看标签页:', this.currentTab.id);

    } catch (error) {
      console.log('[MENG 错误] 请求打开查看页面失败:', error);
      this.showStatus('打开查看页面失败', 'error');
    }
  }

  showStatus(message, type = 'info') {
    const statusEl = document.getElementById('status');
    const originalText = this.isListening ? '正在监听...' : '未监听';
    const originalColor = statusEl.style.color;

    statusEl.textContent = message;

    switch (type) {
      case 'success':
        statusEl.style.color = '#4CAF50';
        break;
      case 'error':
        statusEl.style.color = '#f44336';
        break;
      case 'info':
      default:
        statusEl.style.color = '#2196F3';
        break;
    }

    if (type !== 'error') {
      setTimeout(() => {
        statusEl.textContent = originalText;
        statusEl.style.color = originalColor;
        this.updateUI(); // 恢复 UI 状态
      }, 3000);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('[MENG 日志] Popup 正在初始化...');
  new XHRMonitorPopup();
}); 