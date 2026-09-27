import { useCallback, useEffect, useRef, useState } from 'react';
import { listSamples, downloadSample, sampleUrl, type SampleFormat, type SampleMetaLite } from '../audiotool/sampleClient';
import { AudiotoolDiagnosticsPanel } from '../audiotool/AudiotoolDiagnostics';

const PRESETS: Array<{ label: string; filter: string; orderBy: string; textSearch?: string }> = [
  {
    label: 'Cleared loops, 126 BPM, most used',
    filter: 'sample.sample_type == "SAMPLE_TYPE_LOOP" && sample.bpm >= 125.40 && sample.bpm <= 126.60 && sample.clearance == "SAMPLE_CLEARANCE_SAFE"',
    orderBy: 'sample.num_usages desc',
  },
  {
    label: 'Cleared bass loops, 120–126 BPM',
    filter: 'sample.sample_type == "SAMPLE_TYPE_LOOP" && sample.bpm >= 119.50 && sample.bpm <= 126.50 && sample.clearance == "SAMPLE_CLEARANCE_SAFE"',
    orderBy: 'sample.num_usages desc',
    textSearch: 'bass | bassline | sub',
  },
  {
    label: 'One-shots, most favourited',
    filter: 'sample.sample_type == "SAMPLE_TYPE_ONE_SHOT"',
    orderBy: 'sample.num_favorites desc',
  },
  {
    label: 'Everything, newest first',
    filter: '',
    orderBy: 'sample.create_time desc',
  },
];

type Probe = { status: 'idle' | 'running' | 'ok' | 'error'; message: string };

export function SampleBrowser() {
  const [preset, setPreset] = useState(0);
  const [filter, setFilter] = useState(PRESETS[0]!.filter);
  const [orderBy, setOrderBy] = useState(PRESETS[0]!.orderBy);
  const [textSearch, setTextSearch] = useState(PRESETS[0]!.textSearch ?? '');
  const [pageSize, setPageSize] = useState(25);
  const [samples, setSamples] = useState<SampleMetaLite[]>([]);
  const [nextPageToken, setNextPageToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<SampleMetaLite | null>(null);
  const [probe, setProbe] = useState<Probe>({ status: 'idle', message: '' });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const search = useCallback(async (pageToken = '') => {
    setBusy(true);
    setError('');
    try {
      const result = await listSamples({ filter, orderBy, textSearch, pageSize, pageToken });
      setSamples((current) => (pageToken ? [...current, ...result.samples] : result.samples));
      setNextPageToken(result.nextPageToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [filter, orderBy, textSearch, pageSize]);

  useEffect(() => { void search();}, []);

  const applyPreset = (index: number) => {
    const chosen = PRESETS[index]!;
    setPreset(index);
    setFilter(chosen.filter);
    setOrderBy(chosen.orderBy);
    setTextSearch(chosen.textSearch ?? '');
  };

  const play = (sample: SampleMetaLite, format: SampleFormat) => {
    const url = sampleUrl(sample, format);
    if (!url) return;
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = url;
    audioRef.current.crossOrigin = 'anonymous';
    void audioRef.current.play().catch((caught) => setError(String(caught)));
  };

  const testDownload = async (sample: SampleMetaLite, format: SampleFormat) => {
    setProbe({ status: 'running', message: `Downloading ${format}…` });
    const started = performance.now();
    try {
      const blob = await downloadSample(sample, format);
      const elapsed = performance.now() - started;
      setProbe({
        status: 'ok',
        message: `${format}: ${(blob.size / 1024).toFixed(1)} KB in ${elapsed.toFixed(0)} ms · type ${blob.type || 'unknown'} · no auth header sent`,
      });
    } catch (caught) {
      setProbe({ status: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    }
  };

  return (
    <div className="browser-shell">
      <header className="browser-header">
        <div>
          <h1>AUDIOTOOL SAMPLE BROWSER</h1>
          <small>Unauthenticated read against <code>rpc.audiotool.com</code> · one request at a time, 350 ms apart</small>
        </div>
        <a href="/" className="secondary-button">← Back</a>
      </header>

      <section className="browser-query">
        <div className="browser-presets">
          {PRESETS.map((entry, index) => (
            <button key={entry.label} className={index === preset ? 'chip on' : 'chip'} onClick={() => applyPreset(index)}>
              {entry.label}
            </button>
          ))}
        </div>
        <label>CEL filter<textarea value={filter} rows={2} onChange={(event) => setFilter(event.target.value)} /></label>
        <div className="browser-row">
          <label>textSearch<input value={textSearch} onChange={(event) => setTextSearch(event.target.value)} placeholder="drum | beat" /></label>
          <label>orderBy<input value={orderBy} onChange={(event) => setOrderBy(event.target.value)} /></label>
          <label>pageSize<input type="number" min={1} max={100} value={pageSize} onChange={(event) => setPageSize(Number(event.target.value) || 25)} /></label>
          <button className="primary-button" disabled={busy} onClick={() => void search()}>{busy ? 'SEARCHING…' : 'SEARCH'}</button>
        </div>
        {error && <p className="lab-error">{error}</p>}
      </section>

      <section className="browser-results">
        <table>
          <thead>
            <tr>
              <th>Display name</th><th>Kind</th><th>BPM</th><th>Length</th><th>Clearance</th><th>Owner</th><th>Uses</th><th>Tags</th><th />
            </tr>
          </thead>
          <tbody>
            {samples.map((sample) => (
              <tr key={sample.name} className={selected?.name === sample.name ? 'on' : ''} onClick={() => setSelected(sample)}>
                <td>{sample.displayName || <em>(untitled)</em>}</td>
                <td>{sample.kind}</td>
                <td>{sample.bpm ? sample.bpm.toFixed(2) : '—'}</td>
                <td>{sample.durationSeconds.toFixed(2)}s</td>
                <td className={sample.clearance === 'safe' ? 'ok' : 'warn'}>{sample.clearance}</td>
                <td>{sample.ownerName.replace('users/', '') || '—'}</td>
                <td>{sample.numUsages.toLocaleString()}</td>
                <td className="tags">{sample.tags.slice(0, 4).join(', ')}</td>
                <td><button className="chip" onClick={(event) => { event.stopPropagation(); play(sample, 'preview'); }}>▶</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {samples.length === 0 && !busy && <p className="lab-gate-note">No results for this query.</p>}
        {nextPageToken && <button className="secondary-button" disabled={busy} onClick={() => void search(nextPageToken)}>Load more</button>}
      </section>

      {selected && (
        <aside className="browser-detail">
          <h2>{selected.displayName || '(untitled)'}</h2>
          <code>{selected.name}</code>
          {selected.description && <p>{selected.description}</p>}
          <dl>
            <dt>owner</dt><dd>{selected.ownerName || '—'}</dd>
            <dt>kind / clearance</dt><dd>{selected.kind} · {selected.clearance}</dd>
            <dt>bpm / duration</dt><dd>{selected.bpm || '—'} · {selected.durationSeconds.toFixed(3)}s</dd>
            <dt>beats at tagged bpm</dt><dd>{selected.bpm ? (selected.durationSeconds * selected.bpm / 60).toFixed(3) : '—'}</dd>
            <dt>uses / favourites</dt><dd>{selected.numUsages.toLocaleString()} · {selected.numFavorites.toLocaleString()}</dd>
            <dt>tags</dt><dd>{selected.tags.join(', ') || '—'}</dd>
          </dl>
          <div className="browser-formats">
            {(['preview', 'mp3', 'wav', 'flac'] as SampleFormat[]).map((format) => (
              <div key={format}>
                <strong>{format}</strong>
                <button className="chip" onClick={() => play(selected, format)}>play</button>
                <button className="chip" onClick={() => void testDownload(selected, format)}>download test</button>
              </div>
            ))}
          </div>
          {probe.status !== 'idle' && <p className={`probe-${probe.status}`}>{probe.message}</p>}
          <AudiotoolDiagnosticsPanel />
        </aside>
      )}
    </div>
  );
}
