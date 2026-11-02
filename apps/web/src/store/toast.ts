import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'info';
}

interface ToastState {
  toasts: Toast[];
  push(text: string, kind?: Toast['kind']): void;
  dismiss(id: number): void;
}

let nextId = 1;
const TOAST_MS = 4500;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(text, kind = 'error') {
    const id = nextId++;
    set({ toasts: [...get().toasts.slice(-3), { id, text, kind }] });
    setTimeout(() => get().dismiss(id), TOAST_MS);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export const toastError = (text: string) => useToasts.getState().push(text, 'error');
export const toastInfo = (text: string) => useToasts.getState().push(text, 'info');
