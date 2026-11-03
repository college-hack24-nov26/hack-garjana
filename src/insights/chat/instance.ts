/**
 * The chat store and providers used by the app. When the backend reports a
 * configured Groq model, answers are worded by it (with local fallback);
 * otherwise the local rule-based provider answers.
 */
import { SimStore } from '../../core/SimStore';
import { workspace } from '../../workspace/useWorkspace';
import { ChatStore } from './ChatStore';
import { fetchGroqStatus, groqChatProvider } from './groqProvider';
import type { GroqStatus } from './groqProvider';
import { localChatProvider } from './provider';
import type { ChatProvider } from './types';

export const chatStore = new ChatStore();
export const localChat = localChatProvider(() => workspace);

class ProviderState extends SimStore {
  groq: GroqStatus | null = null;
  set(s: GroqStatus) {
    if (this.groq?.available === s.available && this.groq?.model === s.model) return;
    this.groq = s;
    this.emit();
  }
}
export const providerState = new ProviderState();

/** Asks the backend whether Groq is configured. Safe to call often. */
export async function refreshChatProvider() {
  try {
    providerState.set(await fetchGroqStatus());
  } catch {
    providerState.set({ available: false, model: null });
  }
}

/** The provider that answers chat questions right now. */
export function activeChatProvider(): ChatProvider {
  const g = providerState.groq;
  return g?.available && g.model ? groqChatProvider(localChat, g.model) : localChat;
}

if (import.meta.env.DEV) (window as unknown as { __chat: ChatStore }).__chat = chatStore;
