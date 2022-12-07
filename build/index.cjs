var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  ChatGPTAPI: () => ChatGPTAPI,
  ChatGPTConversation: () => ChatGPTConversation,
  markdownToText: () => markdownToText
});
module.exports = __toCommonJS(src_exports);

// src/chatgpt-api.ts
var import_expiry_map = __toESM(require("expiry-map"), 1);
var import_p_timeout = __toESM(require("p-timeout"), 1);
var import_uuid = require("uuid");

// src/chatgpt-conversation.ts
var ChatGPTConversation = class {
  constructor(api, opts = {}) {
    this.conversationId = void 0;
    this.parentMessageId = void 0;
    this.api = api;
    this.conversationId = opts.conversationId;
    this.parentMessageId = opts.parentMessageId;
  }
  async sendMessage(message, opts = {}) {
    const { onConversationResponse, ...rest } = opts;
    return this.api.sendMessage(message, {
      ...rest,
      conversationId: this.conversationId,
      parentMessageId: this.parentMessageId,
      onConversationResponse: (response) => {
        var _a;
        if (response.conversation_id) {
          this.conversationId = response.conversation_id;
        }
        if ((_a = response.message) == null ? void 0 : _a.id) {
          this.parentMessageId = response.message.id;
        }
        if (onConversationResponse) {
          return onConversationResponse(response);
        }
      }
    });
  }
};

// src/fetch.ts
var _undici;
var fetch = globalThis.fetch ?? async function undiciFetchWrapper(...args) {
  if (!_undici) {
    _undici = await import("undici");
  }
  return _undici.fetch(...args);
};

// src/fetch-sse.ts
var import_eventsource_parser = require("eventsource-parser");

// src/stream-async-iterable.ts
async function* streamAsyncIterable(stream) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

// src/fetch-sse.ts
async function fetchSSE(url, options) {
  const { onMessage, ...fetchOptions } = options;
  const res = await fetch(url, fetchOptions);
  if (!res.ok) {
    throw new Error(`ChatGPTAPI error ${res.status || res.statusText}`);
  }
  const parser = (0, import_eventsource_parser.createParser)((event) => {
    if (event.type === "event") {
      onMessage(event.data);
    }
  });
  if (!res.body.getReader) {
    const body = res.body;
    if (!body.on || !body.read) {
      throw new Error('unsupported "fetch" implementation');
    }
    body.on("readable", () => {
      let chunk;
      while (null !== (chunk = body.read())) {
        parser.feed(chunk.toString());
      }
    });
  } else {
    for await (const chunk of streamAsyncIterable(res.body)) {
      const str = new TextDecoder().decode(chunk);
      parser.feed(str);
    }
  }
}

// src/utils.ts
var import_remark = require("remark");
var import_strip_markdown = __toESM(require("strip-markdown"), 1);
function markdownToText(markdown) {
  return (0, import_remark.remark)().use(import_strip_markdown.default).processSync(markdown ?? "").toString();
}

// src/chatgpt-api.ts
var KEY_ACCESS_TOKEN = "accessToken";
var USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36";
var ChatGPTAPI = class {
  constructor(opts) {
    const {
      sessionToken,
      markdown = true,
      apiBaseUrl = "https://chat.openai.com/api",
      backendApiBaseUrl = "https://chat.openai.com/backend-api",
      userAgent = USER_AGENT,
      accessTokenTTL = 6e4
    } = opts;
    this._sessionToken = sessionToken;
    this._markdown = !!markdown;
    this._apiBaseUrl = apiBaseUrl;
    this._backendApiBaseUrl = backendApiBaseUrl;
    this._userAgent = userAgent;
    this._accessTokenCache = new import_expiry_map.default(accessTokenTTL);
    if (!this._sessionToken) {
      throw new Error("ChatGPT invalid session token");
    }
  }
  async sendMessage(message, opts = {}) {
    const {
      conversationId,
      parentMessageId = (0, import_uuid.v4)(),
      timeoutMs,
      onProgress,
      onConversationResponse
    } = opts;
    let { abortSignal } = opts;
    let abortController = null;
    if (timeoutMs && !abortSignal) {
      abortController = new AbortController();
      abortSignal = abortController.signal;
    }
    const accessToken = await this.refreshAccessToken();
    const body = {
      action: "next",
      messages: [
        {
          id: (0, import_uuid.v4)(),
          role: "user",
          content: {
            content_type: "text",
            parts: [message]
          }
        }
      ],
      model: "text-davinci-002-render",
      parent_message_id: parentMessageId
    };
    if (conversationId) {
      body.conversation_id = conversationId;
    }
    const url = `${this._backendApiBaseUrl}/conversation`;
    let response = "";
    const responseP = new Promise((resolve, reject) => {
      fetchSSE(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "user-agent": this._userAgent
        },
        body: JSON.stringify(body),
        signal: abortSignal,
        onMessage: (data) => {
          var _a, _b;
          if (data === "[DONE]") {
            return resolve(response);
          }
          try {
            const parsedData = JSON.parse(data);
            if (onConversationResponse) {
              onConversationResponse(parsedData);
            }
            const message2 = parsedData.message;
            if (message2) {
              let text = (_b = (_a = message2 == null ? void 0 : message2.content) == null ? void 0 : _a.parts) == null ? void 0 : _b[0];
              if (text) {
                if (!this._markdown) {
                  text = markdownToText(text);
                }
                response = text;
                if (onProgress) {
                  onProgress(text);
                }
              }
            }
          } catch (err) {
            console.warn("fetchSSE onMessage unexpected error", err);
            reject(err);
          }
        }
      }).catch(reject);
    });
    if (timeoutMs) {
      if (abortController) {
        ;
        responseP.cancel = () => {
          abortController.abort();
        };
      }
      return (0, import_p_timeout.default)(responseP, {
        milliseconds: timeoutMs,
        message: "ChatGPT timed out waiting for response"
      });
    } else {
      return responseP;
    }
  }
  async getIsAuthenticated() {
    try {
      void await this.refreshAccessToken();
      return true;
    } catch (err) {
      return false;
    }
  }
  async ensureAuth() {
    return await this.refreshAccessToken();
  }
  async refreshAccessToken() {
    const cachedAccessToken = this._accessTokenCache.get(KEY_ACCESS_TOKEN);
    if (cachedAccessToken) {
      return cachedAccessToken;
    }
    try {
      const res = await fetch("https://chat.openai.com/api/auth/session", {
        headers: {
          cookie: `__Secure-next-auth.session-token=${this._sessionToken}`,
          "user-agent": this._userAgent
        }
      }).then((r) => {
        if (!r.ok) {
          throw new Error(`${r.status} ${r.statusText}`);
        }
        return r.json();
      });
      const accessToken = res == null ? void 0 : res.accessToken;
      if (!accessToken) {
        throw new Error("Unauthorized");
      }
      const error = res == null ? void 0 : res.error;
      if (error) {
        if (error === "RefreshAccessTokenError") {
          throw new Error("session token may have expired");
        } else {
          throw new Error(error);
        }
      }
      this._accessTokenCache.set(KEY_ACCESS_TOKEN, accessToken);
      return accessToken;
    } catch (err) {
      throw new Error(`ChatGPT failed to refresh auth token. ${err.toString()}`);
    }
  }
  getConversation(opts = {}) {
    return new ChatGPTConversation(this, opts);
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ChatGPTAPI,
  ChatGPTConversation,
  markdownToText
});
//# sourceMappingURL=index.cjs.map