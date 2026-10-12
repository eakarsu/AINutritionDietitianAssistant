import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import NativeWorkflowStudio from './NativeWorkflowStudio';
import config from './nativeWorkflowConfig.json';

global.IS_REACT_ACT_ENVIRONMENT = true;

const response = (value) => Promise.resolve(value);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const click = async (element) => {
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); await settle(); });
};

describe('native nutrition AI workspace', () => {
  let container;
  let root;
  let calls;
  let request;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    calls = [];
    request = jest.fn((path, options = {}) => {
      calls.push({ path, options });
      if (path.startsWith('/api/ai/history')) return response({ data: [{
        id: 701,
        endpoint: '/meal-plans/ai-generate',
        feature_table: 'meal_plans',
        feature_id: 42,
        created_at: '2026-10-10T14:00:00.000Z',
        result: JSON.stringify({ overview: { status: 'Saved recommendation', confidence: 'medium' }, nutrients: [{ nutrient: 'Fiber', amount: '28 g' }, { nutrient: 'Protein', amount: '92 g' }] })
      }] });
      if (options.method === 'POST') return response({ parsed: { summary: { status: 'Fixture response', calories: 2100 }, meal_options: [{ meal: 'Breakfast', food: 'Oatmeal and berries' }, { meal: 'Lunch', food: 'Lentil grain bowl' }] } });
      return response({ data: [{ id: 42, title: 'Controlled fixture record', food_items: ['oats', 'berries'] }] });
    });
    await act(async () => { root.render(<NativeWorkflowStudio config={config} request={request} />); await settle(); });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  test('all three presets fill every required and optional field for every AI tool', async () => {
    for (const feature of config.features) {
      const tool = [...container.querySelectorAll('nav[aria-label="AI tools"] button')].find((button) => button.textContent === feature.title);
      expect(tool).toBeTruthy();
      await click(tool);

      const presetButtons = [...container.querySelectorAll('.native-ai-control-buttons button')].filter((button) => button.textContent.startsWith('Demo AI ·'));
      expect(presetButtons).toHaveLength(3);
      for (const preset of presetButtons) {
        await click(preset);
        const controls = [...container.querySelectorAll('.native-workflow-fields input, .native-workflow-fields textarea, .native-workflow-fields select')];
        expect(controls).toHaveLength(feature.fields.length);
        controls.forEach((control, index) => {
          expect({ context: `${feature.id}/${preset.textContent}/${feature.fields[index].key}`, value: control.value }).not.toEqual(expect.objectContaining({ value: '' }));
          if (feature.fields[index].type === 'json') expect(() => JSON.parse(control.value)).not.toThrow();
        });
      }
    }
  });

  test('renders returned and saved structured JSON as labeled cards and tables', async () => {
    const firstTool = [...container.querySelectorAll('nav[aria-label="AI tools"] button')].find((button) => button.textContent === config.features[0].title);
    await click(firstTool);
    await click([...container.querySelectorAll('.native-ai-control-buttons button')].find((button) => button.textContent === 'Demo AI · Team planning'));

    const form = container.querySelector('.native-workflow-layout form');
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle(); await settle(); });

    const post = calls.find((call) => call.options.method === 'POST');
    expect(post.path).toBe(config.features[0].endpoint);
    const payload = JSON.parse(post.options.body);
    expect(Object.keys(payload).sort()).toEqual(config.features[0].fields.map((field) => field.key).sort());
    expect(container.textContent).toContain('Fixture response');
    expect(container.textContent).toContain('Meal options');
    expect(container.querySelector('.ai-report-table')).toBeTruthy();

    expect(container.textContent).toContain('Saved AI results');
    const openSaved = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Open saved report');
    await click(openSaved);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Saved recommendation');
    expect(dialog.textContent).toContain('Nutrients');
    expect(dialog.querySelector('.ai-report-table')).toBeTruthy();
    expect(dialog.querySelectorAll('.ai-report-table th')).toHaveLength(2);
  });
});
