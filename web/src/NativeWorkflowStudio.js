import React, { useCallback, useEffect, useRef, useState } from 'react';
import NativeAIControls from './components/NativeAIControls';
import NativeAIReport from './components/NativeAIReport';
import useNativeAIRequest from './components/useNativeAIRequest';
import './NativeWorkflowStudio.css';

const label = (key) => String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (character) => character.toUpperCase());
const list = (value) => Array.isArray(value) ? value : value?.data || value?.rows || value?.items || [];
const presetNames = ['Quick brief', 'Team planning', 'Detailed review'];

const examples = {
  activity_level: ['Light activity: two walks and two strength sessions weekly', 'Moderate activity: 150 minutes of cardio plus two strength sessions weekly', 'High activity: endurance training five days per week'],
  age: [32, 45, 58],
  allergens_to_avoid: ['Peanuts and sesame', 'Milk, egg and tree nuts', 'Shellfish and wheat'],
  allergies: ['Peanut allergy with prior hives', 'Milk and egg allergy', 'Shellfish allergy; avoid cross-contact'],
  available_time_per_day_minutes: [30, 60, 90],
  budget: [75, 120, 180],
  budget_usd: [95, 150, 220],
  calories_target: [1800, 2100, 2400],
  climate: ['Temperate indoor work environment', 'Warm and humid summer climate', 'Hot climate with prolonged outdoor activity'],
  context: ['Adult seeking a practical weekday nutrition review', 'Family meal-planning discussion with shared cooking responsibilities', 'Detailed dietitian review; identify assumptions and questions for follow-up'],
  cuisine: ['Mediterranean', 'Mexican-inspired', 'Japanese-inspired'],
  current_diet: ['Three mixed meals daily with limited fish and legumes', 'Mostly vegetarian diet with dairy and eggs', 'Plant-forward diet with frequent endurance-training snacks'],
  current_intake: [1600, 2100, 2600],
  current_weight: [168, 184, 205],
  current_weight_kg: [68, 82, 94],
  daily_calories: [1800, 2200, 2600],
  days: [3, 5, 7],
  demographics: ['Adult, age 32; review using general adult reference ranges', 'Adult, age 45; moderately active', 'Adult, age 58; discuss individual reference ranges with a clinician'],
  diet_description: ['Mixed diet with vegetables at dinner and little seafood', 'Vegetarian diet with dairy, eggs, legumes and fortified foods', 'Plant-forward diet; provide a detailed nutrient adequacy review'],
  dietary_needs: ['High-fiber meals; avoid peanuts', 'Vegetarian meals with at least 25 g protein per serving', 'Lower-sodium meals suitable for batch preparation'],
  dietary_pattern: ['Omnivore', 'Lacto-ovo vegetarian', 'Plant-forward Mediterranean pattern'],
  dietary_preference: ['Mediterranean-style', 'Lacto-ovo vegetarian', 'Plant-forward, high-fiber'],
  dietary_preferences: ['Mediterranean-style; no peanuts', 'Vegetarian with dairy and eggs', 'Plant-forward, lower sodium and high fiber'],
  dietary_restrictions: ['Avoid peanuts', 'Vegetarian; no shellfish', 'Gluten-free and lower sodium'],
  dish: ['Grilled chicken grain bowl', 'Black bean vegetable tacos', 'Salmon rice bowl with sauce on the side'],
  equipment: ['Sheet pan, saucepan and chef knife', 'Oven, blender, pressure cooker and storage containers', 'Stovetop, oven, food processor and freezer-safe containers'],
  experience_level: ['New to time-restricted eating', 'Some prior experience with a 12-hour overnight fast', 'Experienced; requesting a safety-focused schedule review'],
  fitness_goal: ['Support general strength training', 'Fuel half-marathon training while maintaining weight', 'Support muscle gain with recovery-focused meals'],
  food_items: ['Oatmeal with blueberries, Greek yogurt and walnuts', 'Brown rice bowl with tofu, broccoli, carrots and sesame dressing', 'Salmon, roasted potatoes, spinach salad and an orange'],
  food_log: ['Day 1: oatmeal, yogurt, lentil soup, apple, chicken and brown rice. Day 2: eggs, toast, bean salad, almonds, salmon and broccoli.', 'Five-day vegetarian log: oats, yogurt, lentils, tofu, leafy greens, fruit, whole grains and fortified soy milk.', 'Seven-day food diary with portions: mixed whole grains, legumes, fish twice, vegetables at lunch and dinner, fruit, dairy and occasional packaged snacks.'],
  food_name: ['Cooked oatmeal with blueberries', 'Black bean and brown rice bowl', 'Grilled salmon with roasted vegetables'],
  gender: ['Woman', 'Man', 'Nonbinary adult; use individualized clinical interpretation'],
  goal: ['Maintain weight while improving afternoon energy', 'Reduce sodium and improve meal consistency', 'Support endurance training and recovery with a reviewable nutrition plan'],
  health_conditions: ['None reported; screen for contraindications before recommending fasting', 'History of reflux; review meal timing with a clinician', 'Takes prescription medication with food; clinician review required before changing meal timing'],
  health_goals: ['Improve dietary vitamin D and omega-3 intake', 'Support iron status on a vegetarian diet', 'Review recovery nutrition without replacing clinician or pharmacist advice'],
  height_cm: [165, 175, 185],
  household_size: [2, 4, 6],
  ingredients: ['Chickpeas, spinach, tomatoes, brown rice and lemon', 'Black beans, corn tortillas, cabbage, avocado and lime', 'Salmon, quinoa, broccoli, carrots and ginger'],
  kitchen_constraints: ['One oven and two burners; weekday prep under 45 minutes', 'Shared kitchen; avoid simultaneous oven and stovetop use', 'Small kitchen, limited freezer space and one batch-cooking session'],
  known_allergies: ['Peanuts', 'Milk and egg', 'Shellfish; cross-contact precautions required'],
  meal_plan: ['Three Mediterranean-style dinners and two packed lunches', 'Five vegetarian dinners with planned leftovers', 'Seven-day lower-sodium plan with breakfast, lunch, dinner and snacks'],
  meal_plans: [
    [{ day: 'Monday', meals: ['Oatmeal with berries', 'Lentil salad', 'Sheet-pan chicken and vegetables'] }],
    [{ day: 'Monday', meals: ['Yogurt parfait', 'Bean bowl', 'Vegetable tacos'] }, { day: 'Tuesday', meals: ['Egg toast', 'Leftover tacos', 'Tofu stir-fry'] }],
    [{ day: 'Monday', meals: ['Overnight oats', 'Quinoa chickpea salad', 'Salmon with broccoli'] }, { day: 'Tuesday', meals: ['Egg and spinach wrap', 'Lentil soup', 'Tofu vegetable curry'] }, { day: 'Wednesday', meals: ['Yogurt and fruit', 'Leftover curry', 'Chicken grain bowl'] }]
  ],
  meal_time: ['2026-10-10T08:00', '2026-10-10T12:30', '2026-10-10T18:45'],
  meals: ['Three weekday lunches: lentil bowls, chicken grain bowls and tofu stir-fry', 'Five dinners with two planned leftover lunches', 'Seven days of breakfast, lunch, dinner and two snacks with batch-cooking dependencies'],
  meals_per_day: [3, 4, 5],
  medication_names: [['levothyroxine'], ['warfarin', 'metformin'], ['lisinopril', 'atorvastatin']],
  medications: ['None reported', 'Metformin; pharmacist review requested for supplement timing', 'Prescription medications listed in the chart; do not recommend changes without pharmacist review'],
  members: [
    [{ name: 'Alex', age: 34, goal: 'balanced meals', allergies: ['peanut'], preferences: ['Mediterranean'] }],
    [{ name: 'Alex', age: 34, goal: 'balanced meals', allergies: ['peanut'] }, { name: 'Sam', age: 11, goal: 'age-appropriate variety', allergies: [], preferences: ['vegetarian lunches'] }],
    [{ name: 'Alex', age: 34, goal: 'maintain weight', allergies: ['peanut'] }, { name: 'Sam', age: 11, goal: 'age-appropriate variety', allergies: [] }, { name: 'Jordan', age: 67, goal: 'lower sodium', allergies: ['shellfish'] }]
  ],
  message: ['Review this one-day food log and identify the most useful follow-up question.', 'Help our household prepare a balanced five-day meal plan with clear responsibilities.', 'Analyze the supplied nutrition pattern, state uncertainties, compare options and propose measurable follow-up steps.'],
  modifications: ['Sauce on the side', 'No cheese; add extra vegetables', 'Half sauce, grilled preparation and no added salt if available'],
  original_food: ['Whole milk', 'Ground beef', 'White rice'],
  pantry_items: ['Olive oil, brown rice, canned chickpeas and spices', 'Oats, lentils, frozen vegetables, eggs and whole-grain bread', 'Quinoa, black beans, canned tomatoes, herbs, nuts and frozen berries'],
  portion_size: ['1 cooked cup', '1 bowl, approximately 450 g', '150 g salmon with 2 cups vegetables'],
  query: ['A quick high-fiber lunch using pantry staples', 'How can a vegetarian family improve iron intake?', 'Compare evidence-based recovery meal options after a long endurance session'],
  reason: ['Reduce saturated fat while preserving texture', 'Choose a plant-forward option with similar protein', 'Increase whole-grain intake and fiber'],
  restaurant: ['Neighborhood cafe', 'Local Mexican restaurant', 'Example Japanese restaurant'],
  restrictions: ['Avoid peanuts', 'Vegetarian and lactose-free', 'Lower sodium; avoid shellfish and clearly flag uncertainty'],
  schedule: ['Wake at 07:00, work 09:00–17:00 and dinner near 19:00', 'Early shift 06:00–14:00 with evening exercise', 'Variable work schedule; provide options and contraindication checks rather than a rigid protocol'],
  session_id: ['demo-nutrition-review-001', 'demo-team-plan-002', 'demo-detailed-review-003'],
  shared_meals_only: ['true', 'false', 'true'],
  store_preference: ['Any full-service grocery store', 'Local supermarket with bulk staples', 'Farmers market plus a full-service grocery store'],
  supplement_names: [['vitamin D3'], ['iron bisglycinate', 'vitamin C'], ['magnesium glycinate', 'omega-3 fish oil']],
  supplements: ['Vitamin D3, 1000 IU daily', 'Iron supplement as previously directed plus vitamin B12', 'Vitamin D3 and omega-3; verify doses and indications with the care team'],
  symptoms: ['Fatigue after lunch; no diagnosis or laboratory results supplied', 'Low energy and brittle nails; request appropriate follow-up rather than diagnosis', 'Persistent fatigue and muscle weakness; identify urgent flags and recommend clinician evaluation'],
  target_weight: [160, 172, 190],
  target_weight_kg: [65, 76, 88],
  training_type: ['Full-body strength training three times weekly', 'Half-marathon plan with four weekly runs', 'Progressive resistance training five days weekly'],
  transcript: ['Breakfast was oatmeal with blueberries and one cup of milk.', 'At lunch I ate a black bean bowl with brown rice, salsa, lettuce and half an avocado.', 'Dinner was about five ounces of salmon, one cup roasted potatoes, two cups spinach salad and a small orange; dressing amount was uncertain.'],
  type: ['meal-suggestion', 'diet-tip', 'nutrition-question'],
  user_goal: ['Balanced meal under 700 kcal', 'Increase fiber while keeping protein adequate', 'Lower sodium and support endurance recovery'],
  weeks: [8, 12, 16],
  weight: [150, 175, 205],
  weight_kg: [62, 78, 96]
};

function exampleFor(field, index) {
  const candidates = examples[field.key] || field.presets || [];
  const value = candidates[index] ?? field.default ?? '';
  return field.type === 'json' && typeof value !== 'string' ? JSON.stringify(value, null, 2) : String(value);
}

function RecordValue({ value }) {
  if (typeof value === 'string' && /^(?:\[|\{)/.test(value.trim())) {
    try { return <RecordValue value={JSON.parse(value)} />; } catch (_) { /* Keep ordinary text. */ }
  }
  if (value == null) return <span>Not supplied</span>;
  if (Array.isArray(value)) return <ul>{value.map((item, index) => <li key={index}><RecordValue value={item} /></li>)}</ul>;
  if (typeof value === 'object') return <dl>{Object.entries(value).map(([key, item]) => <React.Fragment key={key}><dt>{label(key)}</dt><dd><RecordValue value={item} /></dd></React.Fragment>)}</dl>;
  return <span>{String(value)}</span>;
}

function RecordDialog({ selected, close, request, reload }) {
  const { resource, row } = selected;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(row);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const box = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    box.current?.focus();
    const handleKey = (event) => {
      if (event.key === 'Escape' && !busy) close();
      if (event.key !== 'Tab') return;
      const nodes = [...box.current.querySelectorAll('button,input,textarea,select,[tabindex]')].filter((node) => !node.disabled && node.tabIndex >= 0);
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, [busy, close]);

  async function save() {
    setBusy(true); setError('');
    try {
      const payload = Object.fromEntries((resource.updateFields || resource.fields).map((key) => [key, typeof row[key] === 'object' && typeof form[key] === 'string' ? JSON.parse(form[key]) : form[key]]));
      await request(`${resource.endpoint}/${encodeURIComponent(row.id)}`, { method: 'PUT', body: JSON.stringify(payload) });
      await reload(); close();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm('Delete this saved record?')) return;
    setBusy(true); setError('');
    try { await request(`${resource.endpoint}/${encodeURIComponent(row.id)}`, { method: 'DELETE' }); await reload(); close(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return <div className="native-workflow-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
    <section className="native-workflow-dialog" role="dialog" aria-modal="true" aria-labelledby="native-workflow-record-heading" ref={box} tabIndex={-1}>
      <header><h2 id="native-workflow-record-heading">{row.name || row.title || row.productName || resource.label} · {row.id}</h2><button type="button" disabled={busy} onClick={close}>Cancel</button></header>
      <div className="native-workflow-dialog-body">
        {error && <p role="alert">{error}</p>}
        {editing ? <div className="native-workflow-fields">{resource.fields.map((key) => <label key={key}>{label(key)}{typeof form[key] === 'boolean' ? <input type="checkbox" checked={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.checked })} /> : <textarea value={form[key] && typeof form[key] === 'object' ? JSON.stringify(form[key], null, 2) : form[key] ?? ''} onChange={(event) => setForm({ ...form, [key]: typeof row[key] === 'number' ? Number(event.target.value) : event.target.value })} />}</label>)}</div> : <RecordValue value={row} />}
      </div>
      <footer>{resource.fields?.length > 0 && (editing ? <button type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button> : <button type="button" onClick={() => setEditing(true)}>Edit</button>)}{resource.delete && <button type="button" className="native-workflow-danger" disabled={busy} onClick={remove}>Delete</button>}<button type="button" disabled={busy} onClick={close}>Cancel</button></footer>
    </section>
  </div>;
}

function SavedReportDialog({ row, close }) {
  const box = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; box.current?.focus();
    const handleKey = (event) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', handleKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, [close]);
  const title = `${label((row.endpoint || 'Saved AI result').replace(/^\/?(?:api\/)?/, ''))} · saved report`;
  return <div className="native-workflow-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="native-workflow-dialog native-workflow-report-dialog" role="dialog" aria-modal="true" aria-labelledby="native-workflow-report-heading" ref={box} tabIndex={-1}>
      <header><h2 id="native-workflow-report-heading">{title}</h2><button type="button" onClick={close}>Close</button></header>
      <div className="native-workflow-dialog-body"><NativeAIReport response={row.result_json ?? row.result ?? row.response ?? row} title={title} /></div>
      <footer><button type="button" onClick={close}>Close</button></footer>
    </section>
  </div>;
}

export default function NativeWorkflowStudio({ config, request }) {
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(config.features[0]?.id || '');
  const [form, setForm] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [records, setRecords] = useState({});
  const [recordError, setRecordError] = useState('');
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [selectedHistory, setSelectedHistory] = useState(null);
  const native = useNativeAIRequest();
  const feature = config.features.find((item) => item.id === active);
  const cancel = native.cancel;

  useEffect(() => { cancel(); setForm({}); setResult(null); setError(''); }, [active, cancel]);

  const loadRecords = useCallback(async () => {
    const rows = {};
    const problems = [];
    await Promise.all(config.resources.map(async (resource) => {
      try { rows[resource.key] = list(await request(resource.endpoint)); }
      catch (failure) { rows[resource.key] = []; problems.push(`${resource.label}: ${failure.message}`); }
    }));
    setRecords(rows); setRecordError(problems.join('\n'));
  }, [config.resources, request]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true); setHistoryError('');
    try { setHistory(list(await request('/api/ai/history?limit=50'))); }
    catch (failure) { setHistoryError(failure.message); }
    finally { setHistoryLoading(false); }
  }, [request]);

  useEffect(() => { loadRecords(); loadHistory(); }, [loadHistory, loadRecords]);

  const missingRequired = (feature?.fields || []).filter((field) => {
    const value = form[field.key];
    if (field.type === 'file') return field.required && !(value instanceof File);
    if (value == null || String(value).trim() === '') return field.required;
    return field.resource && !(records[field.resource] || []).some((row) => String(row.id) === String(value));
  });

  async function generate(event) {
    event.preventDefault();
    if (native.busy) return;
    if (missingRequired.length) { setError(`Supply actual ${missingRequired.map((field) => field.label).join(', ')} before generating.`); return; }
    setError(''); setResult(null);
    try {
      const body = {};
      for (const field of feature.fields) {
        const value = form[field.key];
        if (value == null || value === '') continue;
        body[field.key] = field.type === 'json' ? JSON.parse(value) : field.type === 'number' ? Number(value) : field.type === 'boolean' ? value === true || value === 'true' : value;
      }
      let payload = JSON.stringify(body);
      if (feature.fields.some((field) => field.type === 'file')) {
        payload = new FormData();
        for (const [key, value] of Object.entries(body)) payload.append(key, value instanceof File ? value : typeof value === 'object' ? JSON.stringify(value) : String(value));
      }
      const answer = await native.run((signal) => request(feature.endpoint, { method: 'POST', body: payload, signal }));
      setResult(answer);
      await loadHistory();
    } catch (failure) { setError(failure.name === 'AbortError' ? 'Request canceled.' : failure.message); }
  }

  const presets = presetNames.map((name, index) => ({
    name,
    fill: () => {
      const values = {};
      const manual = [];
      feature.fields.forEach((field) => {
        if (field.type === 'file') {
          values[field.key] = form[field.key];
          if (!values[field.key]) manual.push(field.label);
        } else if (field.resource) {
          const options = records[field.resource] || [];
          const current = String(form[field.key] || '');
          const currentIsValid = options.some((row) => String(row.id) === current);
          values[field.key] = currentIsValid ? current : String(options[Math.min(index, options.length - 1)]?.id || '');
          if (!values[field.key]) manual.push(field.label);
        } else {
          values[field.key] = exampleFor(field, index);
          if (!values[field.key]) manual.push(field.label);
        }
      });
      setForm(values);
      return { filled: feature.fields.length - manual.length, manual };
    }
  }));

  return <section className="native-workflow-studio" id="native-ai-studio">
    <header><p className="eyebrow">AI workspace</p><h2>{config.title}</h2><p>Choose a native tool, load a complete example, then generate one response. Presets fill required and optional request fields while keeping real record references and uploads intact.</p></header>
    <div className="native-workflow-layout">
      <nav aria-label="AI tools"><label>Find a tool<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search AI tools" /></label>{config.features.filter((item) => item.title.toLowerCase().includes(search.toLowerCase())).map((item) => <button key={item.id} type="button" aria-current={active === item.id ? 'page' : undefined} onClick={() => setActive(item.id)}>{item.title}</button>)}</nav>
      <main>{feature && <NativeAIControls busy={native.busy} onCancel={native.cancel} presets={presets} context={config.title}>
        <form onSubmit={generate}>
          <h3>{feature.title}</h3><p>{feature.description}</p>
          <div className="native-workflow-fields">{feature.fields.map((field) => <label key={field.key} htmlFor={`native-workflow-${field.key}`}>{field.label}{field.required ? ' *' : ' (optional)'}{field.resource ? <select id={`native-workflow-${field.key}`} value={form[field.key] || ''} required={field.required} onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}><option value="">Choose a stored record</option>{(records[field.resource] || []).map((row) => <option key={row.id} value={row.id}>{row.name || row.title || row.productName || row.first_name || row.id} · {row.id}</option>)}</select> : field.type === 'file' ? <input key={`${active}-${field.key}`} id={`native-workflow-${field.key}`} type="file" accept={field.accept} required={field.required && !form[field.key]} onChange={(event) => setForm({ ...form, [field.key]: event.target.files?.[0] })} /> : field.type === 'number' ? <input id={`native-workflow-${field.key}`} type="number" step="any" value={form[field.key] ?? ''} required={field.required} onChange={(event) => setForm({ ...form, [field.key]: event.target.value })} /> : field.type === 'boolean' ? <select id={`native-workflow-${field.key}`} value={form[field.key] ?? ''} required={field.required} onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}><option value="">Choose yes or no</option><option value="true">Yes</option><option value="false">No</option></select> : <textarea id={`native-workflow-${field.key}`} value={form[field.key] ?? ''} required={field.required} rows={field.type === 'json' ? 6 : 3} placeholder={field.type === 'json' ? 'Enter valid JSON.' : ''} onChange={(event) => setForm({ ...form, [field.key]: event.target.value })} />}</label>)}</div>
          <button type="submit" className="native-workflow-generate" disabled={native.busy || missingRequired.length > 0}>{native.busy ? 'Generating…' : 'Generate with OpenRouter'}</button>
          {missingRequired.length > 0 && <p role="status">Supply actual {missingRequired.map((field) => field.label).join(', ')} before generating.</p>}
          {error && <p className="native-workflow-error" role="alert">{error}</p>}
        </form>
      </NativeAIControls>}{result && <NativeAIReport response={result} title={feature?.title || 'AI report'} />}</main>
    </div>

    <section className="native-workflow-history" aria-labelledby="saved-ai-results-heading">
      <div className="native-workflow-section-heading"><div><p className="eyebrow">Saved output</p><h3 id="saved-ai-results-heading">Saved AI results</h3></div><button type="button" onClick={loadHistory} disabled={historyLoading}>{historyLoading ? 'Loading…' : 'Refresh saved results'}</button></div>
      {historyError && <div className="native-workflow-error" role="alert"><span>{historyError}</span><button type="button" onClick={loadHistory}>Retry</button></div>}
      {!historyLoading && !historyError && !history.length && <p>No saved AI results returned.</p>}
      <div className="native-workflow-history-grid">{history.map((row) => <article key={row.id}><span className="native-workflow-tag">{label((row.feature_table || 'AI result').replace(/^\/?(?:api\/)?/, ''))}</span><h4>{label((row.endpoint || 'Saved AI result').replace(/^\/?(?:api\/)?/, ''))}</h4><dl><div><dt>Reference</dt><dd>{row.id}</dd></div>{row.feature_id != null && <div><dt>Source record</dt><dd>{row.feature_id}</dd></div>}<div><dt>Saved</dt><dd>{row.created_at ? new Date(row.created_at).toLocaleString() : 'Date unavailable'}</dd></div></dl><button type="button" onClick={() => setSelectedHistory(row)}>Open saved report</button></article>)}</div>
    </section>

    <section className="native-workflow-records"><div className="native-workflow-section-heading"><h3>Stored records</h3><button type="button" onClick={loadRecords}>Refresh records</button></div>{recordError && <p className="native-workflow-error" role="alert">{recordError}</p>}{config.resources.map((resource) => <article key={resource.key}><h4>{resource.label}</h4>{!(records[resource.key] || []).length ? <p>No records returned.</p> : <div className="native-workflow-table"><table><thead><tr><th>Record</th><th>Reference</th><th>Details</th></tr></thead><tbody>{records[resource.key].map((row) => <tr key={row.id}><td>{row.name || row.title || row.productName || row.first_name || resource.label}</td><td>{row.id}</td><td><button type="button" onClick={() => setSelected({ resource, row })}>Open record</button></td></tr>)}</tbody></table></div>}</article>)}</section>
    {selected && <RecordDialog key={selected.row.id} selected={selected} close={() => setSelected(null)} request={request} reload={loadRecords} />}
    {selectedHistory && <SavedReportDialog row={selectedHistory} close={() => setSelectedHistory(null)} />}
  </section>;
}
