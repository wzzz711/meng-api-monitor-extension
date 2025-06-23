// content.js - 内容脚本，负责与页面交互和XHR监听

class XHRMonitorContent {
  constructor() {
    this.isListening = false;
    this.requestCount = 0;
    this.overlayElement = null; // 用于存储悬浮窗元素
    this.animationInterval = null; // 存储动画定时器
    this.bodyObserver = null; // 监视 body
    this.injectedScriptReady = false; // 用于跟踪注入脚本的状态
    this.init();
  }

  async init() {
    // 监听来自 popup 的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // 保持消息通道开放
    });

    // 监听来自注入脚本的消息
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data.type === 'XHR_INTERCEPTED') {
        this.handleXHRRequest(event.data.payload);
      }
      
      // 处理握手消息！！！
      if (event.data.type === 'INJECTED_SCRIPT_READY') {
        console.log('[MENG 日志] 收到 Injected Script 的 "Ready" 信号');
        this.injectedScriptReady = true;
        // 如果我们已经在监听状态，立即发送 start 命令
        if (this.isListening) {
          this.notifyPageScript('start');
        }
      }
    });

    console.log('[MENG 日志] XHR 监听器内容脚本已加载');

    const onDOMContentLoaded = async () => {
      console.log('[MENG 日志] DOM 已加载，开始初始化脚本和 UI');
      this.injectScript();
      await this.restoreState();
    };

    // 页面加载时恢复状态和注入脚本！！！
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onDOMContentLoaded);
    } else {
      onDOMContentLoaded();
    }
  }

  async restoreState() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getInitialState' });
      if (response && response.success) {
        console.log('[MENG 日志] 成功恢复状态:', response);
        this.requestCount = response.requestCount || 0;
        if (response.isListening) {
          this.isListening = true;
          this.createOverlay();
          this.observeBody(); // 在恢复状态时也必须启动监视！！！
        }
      }
    } catch (error) {
      console.log('[MENG 错误] 恢复状态失败:', error);
    }
  }

  // 处理来自 popup 的消息
  handleMessage(message, sender, sendResponse) {
    console.log('[MENG 日志] 收到来自 Popup 的消息:', message);
    switch (message.action) {
      case 'startListening':
        this.startListening();
        sendResponse({ success: true });
        break;

      case 'stopListening':
        this.stopListening();
        sendResponse({ success: true });
        break;

      case 'clearRecords':
        this.clearRecords();
        sendResponse({ success: true });
        break;

      case 'getStatus':
        sendResponse({
          success: true,
          isListening: this.isListening,
          requestCount: this.requestCount
        });
        break;

      default:
        sendResponse({ success: false, error: '未知操作' });
    }
  }

  // 开始监听
  startListening() {
    this.isListening = true;
    console.log('[MENG 日志] 开始监听 XHR 请求');
    
    this.injectScript(); 
    
    if (this.injectedScriptReady) {
      this.notifyPageScript('start');
    }
    
    this.createOverlay();
    this.observeBody(); // 启动对 Body 的监视
  }

  // 停止监听
  stopListening() {
    this.isListening = false;
    this.notifyPageScript('stop');
    console.log('[MENG 日志] 停止监听 XHR 请求');
    this.removeOverlay();
    
    if (this.bodyObserver) {
      this.bodyObserver.disconnect();
      this.bodyObserver = null;
      console.log('[MENG 日志] Body observer 已断开');
    }
    // 停止动画
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
      this.animationInterval = null;
    }
  }

  // 清空记录
  clearRecords() {
    this.requestCount = 0;
    this.updateOverlayCount(0);
    console.log('[MENG 日志] 已清空 XHR 请求记录');
  }

  // 注入脚本到页面
  injectScript() {
    // 检查脚本是否已经注入
    if (document.querySelector('script[data-xhr-monitor="injected"]')) {
      console.log('[MENG 日志] 监听脚本已存在，跳过注入');
      return;
    }

    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected.js');
      script.setAttribute('data-xhr-monitor', 'injected');
      script.onload = () => {
        console.log('[MENG 日志] XHR 监听脚本注入成功');
      };
      script.onerror = () => {
        console.log('[MENG 错误] XHR 监听脚本注入失败');
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (error) {
      console.log('[MENG 错误] 注入脚本时发生错误:', error);
    }
  }

  // 通知页面脚本
  notifyPageScript(action) {
    console.log('[MENG 日志] 向页面脚本发送控制消息:', action);
    window.postMessage({
      type: 'XHR_MONITOR_CONTROL',
      action: action
    }, '*');
  }

  // 处理XHR请求数据
  async handleXHRRequest(requestData) {
    if (!this.isListening) {
      return;
    }

    try {
      // 向 background script 发送请求数据进行存储
      const response = await chrome.runtime.sendMessage({
        action: 'storeRequest',
        data: requestData
      });

      if (response && response.success) {
        // 使用后台返回的权威计数
        this.requestCount = response.newCount;
        this.updateOverlayCount(this.requestCount);
        console.log('[MENG 日志] 请求计数更新:', this.requestCount);
        console.log('[MENG 日志] XHR 请求已记录:', requestData.url);
      } else {
        console.log('[MENG 错误] 存储请求失败:', response);
      }
    } catch (error) {
      console.log('[MENG 错误] 处理 XHR 请求失败:', error);
    }
  }

  observeBody() {
    if (this.bodyObserver) {
      this.bodyObserver.disconnect();
    }

    this.bodyObserver = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
        if (mutation.type === 'childList') {
          // 检查悬浮窗是否从 DOM 中被移除了
          let overlayNodeRemoved = false;
          mutation.removedNodes.forEach(node => {
            if (node.id === 'xhr-monitor-overlay-container') {
              overlayNodeRemoved = true;
            }
          });

          if (overlayNodeRemoved && this.isListening) {
            console.log('[MENG 日志] Overlay element 已被移除，正在重新创建...');
            this.overlayElement = null; 
            this.createOverlay();
            return; 
          }
        }
      }
    });

    this.bodyObserver.observe(document.body, {
      childList: true,
      subtree: false // 只关心 body 的直接子节点变化
    });
    
    console.log('[MENG 日志] 正在监视 document.body 以检测悬浮窗移除');
  }

  startBreathingAnimation(element) {
    // 先清除之前的动画，以防万一
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
    }

    let phase = 0;
    const speed = 0.1;

    this.animationInterval = setInterval(() => {
      // 确保元素仍然在 DOM 中
      if (!document.body.contains(element)) {
        clearInterval(this.animationInterval);
        this.animationInterval = null;
        return;
      }
      
      const value = Math.sin(phase);
      const opacity = 0.5 + (value + 1) * 0.25;
      
      element.style.opacity = opacity.toFixed(2);
      
      phase += speed;
      if (phase > Math.PI * 2) {
        phase -= Math.PI * 2;
      }
    }, 30);
  }

  createOverlay() {
    // 如果元素已存在于 DOM 中，则只需确保其可见并更新计数
    const existingOverlay = document.getElementById('xhr-monitor-overlay-container');
    if (existingOverlay) {
      this.overlayElement = existingOverlay;
      this.overlayElement.style.display = 'flex';
      this.updateOverlayCount(this.requestCount);
      // 确保动画在重新创建时也能启动
      const redDot = this.overlayElement.querySelector('.xhr-monitor-red-dot');
      if (redDot) {
        this.startBreathingAnimation(redDot);
      }
      return;
    }

    this.overlayElement = document.createElement('div');
    this.overlayElement.id = 'xhr-monitor-overlay-container';
    
    Object.assign(this.overlayElement.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      backgroundColor: '#2c3e50',
      color: 'white',
      padding: '8px 15px',
      borderRadius: '15px',
      fontSize: '14px',
      fontFamily: `'Segoe UI', Tahoma, sans-serif`,
      zIndex: '2147483647',
      cursor: 'move',
      userSelect: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      boxShadow: '0 4px 10px rgba(0, 0, 0, 0.2)',
      transition: 'background-color 0.3s',
      whiteSpace: 'nowrap'
    });

    const redDot = document.createElement('div');
    redDot.className = 'xhr-monitor-red-dot'; // 添加一个类名便于查找
    Object.assign(redDot.style, {
      width: '8px',
      height: '8px',
      backgroundColor: '#e74c3c',
      borderRadius: '50%',
      opacity: '1'
    });

    const textSpan = document.createElement('span');
    textSpan.innerHTML = `监听中: <strong id="xhr-monitor-count">${this.requestCount}</strong>`;

    this.overlayElement.appendChild(redDot);
    this.overlayElement.appendChild(textSpan);
    document.body.appendChild(this.overlayElement);

    this.makeDraggable(this.overlayElement);
    this.startBreathingAnimation(redDot); // 为新创建的红点启动动画
  }

  removeOverlay() {
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
      this.animationInterval = null;
    }
    if (this.overlayElement && this.overlayElement.parentNode) {
      this.overlayElement.parentNode.removeChild(this.overlayElement);
      this.overlayElement = null;
    }
  }

  updateOverlayCount(count) {
    if (this.overlayElement) {
      const countElement = this.overlayElement.querySelector('#xhr-monitor-count');
      if (countElement) {
        countElement.textContent = count;
      }
    }
  }

  makeDraggable(element) {
    let offsetX = 0, offsetY = 0;

    element.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      e.preventDefault();

      const rect = element.getBoundingClientRect();
      
      element.style.position = 'fixed';
      element.style.top = rect.top + 'px';
      element.style.left = rect.left + 'px';

      element.style.right = 'auto';
      
      // 计算鼠标指针与元素左上角的初始偏移量
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;

      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e.preventDefault();

      // 计算新的位置
      let newLeft = e.clientX - offsetX;
      let newTop = e.clientY - offsetY;

      // 边界检查
      const boundary = 20;
      const docWidth = window.innerWidth;
      const docHeight = window.innerHeight;
      const elemWidth = element.offsetWidth;
      const elemHeight = element.offsetHeight;

      newLeft = Math.max(boundary, newLeft);
      newTop = Math.max(boundary, newTop);

      if ((newLeft + elemWidth) > (docWidth - boundary)) {
        newLeft = docWidth - elemWidth - boundary;
      }
      if ((newTop + elemHeight) > (docHeight - boundary)) {
        newTop = docHeight - elemHeight - boundary;
      }

      element.style.left = newLeft + 'px';
      element.style.top = newTop + 'px';
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }
}

// 初始化内容脚本
console.log('[MENG 日志] 准备初始化 XHR 监听器内容脚本');
new XHRMonitorContent(); 