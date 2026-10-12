import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

global.IS_REACT_ACT_ENVIRONMENT = true;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const jsonResponse = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

describe('demo login', () => {
  let container;
  let root;

  beforeEach(async () => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    global.fetch = jest.fn(async (url, options = {}) => {
      if (url === '/api/health') return jsonResponse({ ok: true });
      if (url === '/api/auth/demo-credentials') return jsonResponse({ email: 'fixture-demo@example.test', password: 'fixture-password' });
      if (url === '/api/auth/login') {
        expect(JSON.parse(options.body)).toEqual({ email: 'fixture-demo@example.test', password: 'fixture-password' });
        return jsonResponse({ token: 'fixture-token' });
      }
      if (url === '/api/auth/me') return jsonResponse({ id: 17, email: 'fixture-demo@example.test', name: 'Demo Dietitian' });
      return jsonResponse({ data: [] });
    });
    await act(async () => { root.render(<App />); await settle(); });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
  });

  test('Log in as Demo uses the configured demo credential endpoint and opens the workspace', async () => {
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent === 'Log in as Demo');
    expect(button).toBeTruthy();
    await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); await settle(); await settle(); });

    expect(localStorage.getItem('authToken')).toBe('fixture-token');
    expect(container.textContent).toContain('AI workspace');
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/demo-credentials', expect.any(Object));
  });
});
