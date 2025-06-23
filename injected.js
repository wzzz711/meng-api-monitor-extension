// injected.js - 注入到页面的脚本，用于拦截XHR和Fetch请求

(function () {
  'use strict';

  let isMonitoring = false;
  let interceptorsInstalled = false;
  let isPageUnloading = false;

  console.log('[MONGO 日志] XHR 监听脚本开始加载，页面:', window.location.href);

  // 添加一个监听器，在页面即将卸载时设置标志
  window.addEventListener('beforeunload', () => {
    isPageUnloading = true;
  });

  // 监听来自 content_script 的控制消息
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (event.data.type === 'XHR_MONITOR_CONTROL') {
      console.log('[MONGO 日志] 收到控制消息:', event.data);
      if (event.data.action === 'start') {
        isMonitoring = true;
        console.log('[MONGO 日志] XHR 监听已启动');

        // 确保拦截器已安装
        if (!interceptorsInstalled) {
          installInterceptors();
        }
      } else if (event.data.action === 'stop') {
        isMonitoring = false;
        console.log('[MONGO 日志] XHR 监听已停止');
      }
    }
  });

  // 保存原始的 fetch，XMLHttpRequest 在拦截器中直接从原型获取
  const originalFetch = window.fetch;

  function installInterceptors() {
    if (interceptorsInstalled) {
      console.log('[MONGO 日志] 拦截器已安装，跳过');
      return;
    }

    try {
      interceptXHR();
      interceptFetch();
      interceptorsInstalled = true;
    } catch (error) {
      console.log('[MONGO 错误] 安装拦截器失败:', error);
    }
  }

  // 拦截 XMLHttpRequest
  function interceptXHR() {
    const pageXHR = window.XMLHttpRequest;

    // 直接修改原型
    const originalProtoOpen = pageXHR.prototype.open;
    const originalProtoSend = pageXHR.prototype.send;

    pageXHR.prototype.open = function(method, url) {
      // 重入守卫: 如果此函数已被我们的监控逻辑调用，则直接调用原始函数以避免递归
      if (this._monitor_is_opening) {
        return originalProtoOpen.apply(this, arguments);
      }
      this._monitor_is_opening = true;

      // 在实例上存储方法和 URL，以便 send 方法可以访问
      this._monitor_method = method;
      this._monitor_url = url;

      const result = originalProtoOpen.apply(this, arguments);
      delete this._monitor_is_opening; // 清理标志
      return result;
    };

    pageXHR.prototype.send = function(body) {
       // 重入守卫
      if (this._monitor_is_sending) {
        return originalProtoSend.apply(this, arguments);
      }
      this._monitor_is_sending = true;


      if (isMonitoring && this._monitor_url) {
        const method = this._monitor_method;
        const url = this._monitor_url;

        const originalOnReadyStateChange = this.onreadystatechange;
        this.onreadystatechange = function() {
          if (!isPageUnloading && this.readyState === 4) {
            try {
              const requestData = {
                url: url,
                method: method || 'GET',
                params: parseRequestData(method || 'GET', url, body),
                res: parseResponseData(this.responseText)
              };
              captureRequest(requestData);
            } catch (error) {
              console.log('[MONGO 错误] 处理XHR响应时发生错误:', error);
            }
          }
          if (originalOnReadyStateChange) {
            originalOnReadyStateChange.apply(this, arguments);
          }
        };
      }
      
      const result = originalProtoSend.apply(this, arguments);
      delete this._monitor_is_sending; // 清理标志
      return result;
    };

    console.log('[MONGO 日志] XMLHttpRequest 拦截器已安装');
  }

  // 拦截 Fetch API
  function interceptFetch() {
    if (!originalFetch) {
      console.log('[MONGO 日志] 当前环境不支持 Fetch API');
      return;
    }

    const fetchGuard = Symbol('fetchGuard');

    window.fetch = function (resource, config) {
      // 重入守卫检查
      if (config && config[fetchGuard]) {
        return originalFetch.call(this, resource, config);
      }

      // 页面卸载检查
      if (isPageUnloading) {
        return Promise.reject(new Error('[MONGO 监控] 页面正在卸载，Fetch请求已取消'));
      }
      
      // 如果未在监控，则直接调用原始fetch
      if (!isMonitoring) {
        return originalFetch.call(this, resource, config);
      }

      // 监控逻辑
      const url = typeof resource === 'string' ? resource : resource.url;
      const method = (config?.method || 'GET').toUpperCase();
      
      // 创建新 config 并添加守卫，重新调用 fetch 以进入 then/catch
      const newConfig = { ...(config || {}) };
      newConfig[fetchGuard] = true;
      
      return window.fetch(resource, newConfig).then(response => {
        if (isPageUnloading) {
          return response;
        }
        try {
          const clonedResponse = response.clone();
          clonedResponse.text().then(responseText => {
            try {
              const requestData = {
                url: url,
                method: method,
                params: parseRequestData(method, url, config?.body),
                res: parseResponseData(responseText)
              };
              captureRequest(requestData);
            } catch (error) {
              console.log('[MONGO 错误] 处理Fetch响应数据时发生错误:', error);
            }
          }).catch(err => {
            if (!isPageUnloading) {
              console.log('[MONGO 错误] 解析fetch响应失败:', err);
            }
          });
        } catch (error) {
          console.log('[MONGO 错误] 克隆fetch响应失败:', error);
        }
        return response;
      }).catch(error => {
        if (!isPageUnloading) {
          console.log('[MONGO 错误] Fetch请求失败:', error);
        }
        throw error;
      });
    };
    console.log('[MONGO 日志] Fetch 拦截器已安装');
  }

  // 捕获请求数据
  function captureRequest(requestData) {
    try {
      window.postMessage({
        type: 'XHR_INTERCEPTED',
        payload: requestData
      }, '*');
    } catch (error) {
      console.log('[MONGO 错误] 发送请求数据失败:', error);
    }
  }

  // 解析请求数据
  function parseRequestData(_, url, body) {
    let params = {};

    // GET 请求或任何带查询字符串的请求，从 URL 解析参数
    if (url) {
      try {
        // 使用一个基础 URL 来处理相对路径
        const fullUrl = new URL(url, window.location.origin);
        if (fullUrl.search) {
          params = Object.fromEntries(fullUrl.searchParams.entries());
        }
      } catch (e) {
        console.log('[MONGO 错误] 解析URL参数失败:', e);
      }
    }

    // 如果是 POST/PUT 等请求，从请求体解析参数
    if (body) {
      try {
        let parsedBody = {};
        if (typeof body === 'string') {
          try {
            parsedBody = JSON.parse(body);
          } catch {
            // 尝试解析 URL 编码的数据
            if (body.includes('=')) {
              const urlParams = new URLSearchParams(body);
              parsedBody = Object.fromEntries(urlParams.entries());
            } else {
              // 如果不是 JSON 或 URL 编码，则作为原始字符串处理
              // 仅当 body 不为空时才添加
              if (body.trim()) {
                parsedBody = { raw: body };
              }
            }
          }
        } else if (body instanceof FormData) {
          parsedBody = Object.fromEntries(body.entries());
        } else if (body instanceof URLSearchParams) {
          parsedBody = Object.fromEntries(body.entries());
        } else if (typeof body === 'object') {
          parsedBody = body;
        }

        // 将请求体参数与 URL 参数合并，请求体参数优先
        params = { ...params, ...parsedBody };

      } catch (error) {
        console.log('[MONGO 错误] 解析请求体失败:', error);
        // 仅在有意义时添加原始 body
        const rawBody = body?.toString();
        if (rawBody && rawBody.trim()) {
          params.body = { raw: rawBody };
        }
      }
    }

    return params;
  }

  // 解析响应数据
  function parseResponseData(responseText) {
    try {
      // 尝试解析为 JSON，如果失败，则作为原始文本返回
      return JSON.parse(responseText);
    } catch (e) {
      // 创建一个特殊结构来标记它为非 JSON 数据！！！
      return {
        __isNonJson: true,
        __originalText: responseText
      };
    }
  }

  // 立即安装拦截器（即使还没有开始监听）
  installInterceptors();

  console.log('[MONGO 日志] injected.js 脚本已完全执行。');

  // 通知 content_script 脚本已准备好接收指令！！！
  try {
    window.postMessage({
      type: 'INJECTED_SCRIPT_READY'
    }, '*');
    console.log('[MONGO 日志] Ready 信号已发送给 content_script.js');
  } catch(e) {
    console.log('[MONGO 错误] 发送 Ready 信号失败:', e);
  }

})(); 