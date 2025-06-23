// background.js - 后台服务工作脚本

class XHRMonitorBackground {
  constructor() {
    this.init();
  }

  init() {
    // 监听标签页关闭事件 - 这是唯一自动清空数据的方式
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.cleanupTabData(tabId);
    });

    // 扩展安装或启动时的初始化
    chrome.runtime.onInstalled.addListener(() => {
      console.log('[MENG 日志] XHR 监听器已安装');
    });

    // 监听来自 content script 的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // 保持消息通道开放以支持异步响应
    });
  }

  // 清理指定标签页的数据
  async cleanupTabData(tabId) {
    try {
      const tabIdStr = tabId.toString();
      await chrome.storage.local.remove([tabIdStr, `state_${tabIdStr}`]); // 同时清理数据和状态
      console.log(`[MENG 日志] 已清理标签页 ${tabId} 的数据和状态`);
    } catch (error) {
      console.log(`[MENG 错误] 清理标签页 ${tabId} 数据失败:`, error);
    }
  }

  // 处理来自 content script 的消息
  async handleMessage(message, sender, sendResponse) {
    try {
      // 优先使用消息中指定的tabId，否则回退到发送者的 tabId！！！
      const tabId = message.tabId || sender.tab?.id;

      if (!tabId) {
        sendResponse({ success: false, error: '无法确定目标标签页' });
        return;
      }

      switch (message.action) {
        case 'storeRequest':
          const newCount = await this.storeRequest(message.data, tabId);
          sendResponse({ success: true, newCount: newCount });
          break;
        
        case 'getPopupState': // 由 popup 调用
          const state = await this.getTabState(tabId);
          sendResponse({ success: true, ...state });
          break;

        case 'getInitialState': // 由 content script 调用
          const initialState = await this.getTabState(tabId);
          sendResponse({ success: true, ...initialState });
          break;

        case 'getStoredRequests':
          const requests = await this.getStoredRequests(tabId);
          sendResponse({ success: true, data: requests });
          break;

        default:
          sendResponse({ success: false, error: '未知操作' });
      }
    } catch (error) {
      console.log('[MENG 错误] 处理消息失败:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  // 获取单个标签页的完整状态
  async getTabState(tabId) {
    const stateKey = `state_${tabId}`;
    const dataKey = `${tabId}`;
    const result = await chrome.storage.local.get([stateKey, dataKey]);
    return {
      isListening: result[stateKey] || false,
      requestCount: (result[dataKey] || []).length
    };
  }

  // 存储请求数据
  async storeRequest(requestData, tabId) {
    const tabIdStr = tabId.toString();

    // 获取当前存储的请求
    const result = await chrome.storage.local.get([tabIdStr]);
    const requests = result[tabIdStr] || [];

    // 添加新请求
    requests.push({
      ...requestData,
      timestamp: Date.now(),
      id: this.generateId()
    });

    // 存储更新后的请求列表
    await chrome.storage.local.set({
      [tabIdStr]: requests
    });
    
    const newCount = requests.length;

    // 广播计数更新消息，以便 popup 可以接收！！！
    chrome.runtime.sendMessage({
      action: 'updateCount',
      count: newCount,
      tabId: tabId
    }).catch(e => console.log("[MENG 错误] 发送更新计数广播失败 (可能是没有接收方):", e));

    console.log(`[MENG 日志] 已存储请求到标签页 ${tabId}, 总数: ${newCount}`);
    return newCount; // 返回最新的数量
  }

  // 获取存储的请求数据
  async getStoredRequests(tabId) {
    const tabIdStr = tabId.toString();
    const result = await chrome.storage.local.get([tabIdStr]);
    return result[tabIdStr] || [];
  }

  // 生成唯一 ID
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}

// 初始化后台服务
new XHRMonitorBackground(); 