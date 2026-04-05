// web/src/hooks/useVSCodeAPI.ts

import { useCallback, useEffect, useRef } from 'react';

interface VSCodeAPI {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

let vscodeApi: VSCodeAPI | null = null;

function getVSCodeAPI(): VSCodeAPI {
  if (!vscodeApi) {
    vscodeApi = acquireVsCodeApi();
  }
  return vscodeApi;
}

export type ExtensionMessage =
  | { type: 'init'; isAuthenticated: boolean; messages: ChatMsg[] }
  | { type: 'streamText'; text: string }
  | { type: 'toolCall'; toolName: string; toolCallId: string; args?: any }
  | { type: 'toolResult'; toolCallId: string; result: string; isError: boolean }
  | { type: 'fileWrite'; filePath: string }
  | { type: 'streamEnd' }
  | { type: 'error'; error: string }
  | { type: 'chatReset' }
  | { type: 'authState'; isAuthenticated: boolean }
  | { type: 'authRequired'; error: string }
  | { type: 'status'; text: string };

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export function useVSCodeAPI() {
  const api = useRef(getVSCodeAPI());

  const postMessage = useCallback((message: any) => {
    api.current.postMessage(message);
  }, []);

  const sendMessage = useCallback(
    (text: string) => {
      postMessage({ type: 'sendMessage', text });
    },
    [postMessage],
  );

  const stopGeneration = useCallback(() => {
    postMessage({ type: 'stopGeneration' });
  }, [postMessage]);

  const signIn = useCallback(() => {
    postMessage({ type: 'signIn' });
  }, [postMessage]);

  const signOut = useCallback(() => {
    postMessage({ type: 'signOut' });
  }, [postMessage]);

  const newChat = useCallback(() => {
    postMessage({ type: 'newChat' });
  }, [postMessage]);

  const connectConvex = useCallback(() => {
    postMessage({ type: 'connectConvex' });
  }, [postMessage]);

  const openFile = useCallback(
    (filePath: string) => {
      postMessage({ type: 'openFile', filePath });
    },
    [postMessage],
  );

  return {
    postMessage,
    sendMessage,
    stopGeneration,
    signIn,
    signOut,
    newChat,
    connectConvex,
    openFile,
  };
}

export function useExtensionMessages(handler: (msg: ExtensionMessage) => void) {
  useEffect(() => {
    const listener = (event: MessageEvent<ExtensionMessage>) => {
      handler(event.data);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [handler]);
}
