/**
 * The chat store and providers used by the app. Only the local, rule-based
 * provider exists today; a backend provider would be registered here.
 */
import { workspace } from '../../workspace/useWorkspace';
import { ChatStore } from './ChatStore';
import { localChatProvider } from './provider';
import type { ChatProvider } from './types';

export const chatStore = new ChatStore();
export const localChat = localChatProvider(() => workspace);

/** The provider that answers chat questions. Local only in this build. */
export function activeChatProvider(): ChatProvider {
  return localChat;
}

if (import.meta.env.DEV) (window as unknown as { __chat: ChatStore }).__chat = chatStore;
