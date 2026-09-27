import { useEffect, useState } from 'react';
import { AUDIOTOOL_URL, QUATERNIUS_URL } from './links';

type Asset = { what: string; by: string; byUrl?: string; license: string; text?: string };

const ASSETS: Asset[] = [
  { what: 'Characters and animations', by: 'Quaternius', byUrl: QUATERNIUS_URL, license: 'CC0 1.0', text: '/licenses/quaternius-CC0.txt' },
  { what: 'Loops', by: 'Audiotool sample library', byUrl: AUDIOTOOL_URL, license: 'Audiotool terms', text: 'https://www.audiotool.com/terms' },
  { what: 'Disco ball', by: 'Cough-E', byUrl: 'https://opengameart.org/content/disco-ball-0', license: 'CC0 1.0', text: '/licenses/disco-ball-opengameart.txt' },
  { what: 'Space Grotesk', by: 'Florian Karsten', byUrl: 'https://github.com/floriankarsten/space-grotesk', license: 'OFL 1.1', text: '/licenses/space-grotesk-OFL-1.1.txt' },
  { what: 'Signalsmith Stretch', by: 'Signalsmith Audio', byUrl: 'https://github.com/Signalsmith-Audio/signalsmith-stretch', license: 'MIT', text: '/licenses/signalsmith-stretch-MIT.txt' },
  { what: 'Draco decoder', by: 'Google', byUrl: 'https://github.com/google/draco', license: 'Apache 2.0', text: '/licenses/draco-Apache-2.0.txt' },
];

type Package = { name: string; version: string; license: string; url: string };

const PACKAGES_URL = '/licenses/third-party.json';
const PACKAGES_TEXT = '/licenses/third-party.txt';

export function Licenses() {
  const [packages, setPackages] = useState<Package[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch(PACKAGES_URL)
      .then((response) => (response.ok ? response.json() as Promise<Package[]> : []))
      .then((list) => { if (live) setPackages(list); })
      .catch(() => { if (live) setPackages([]); });
    return () => { live = false; };
  }, []);

  return (
    <section className="about licenses">
      <div className="about-intro">
        <h1 className="display">
          Licenses<span className="dot">.</span>
        </h1>
      </div>

      <div className="about-body">
        <h2>Assets</h2>
        <ul className="license-list">
          {ASSETS.map((asset) => (
            <li key={asset.what}>
              <span>
                <strong>{asset.what}</strong>
                {' · '}
                {asset.byUrl ? <a href={asset.byUrl} target="_blank" rel="noreferrer">{asset.by}</a> : asset.by}
              </span>
              {asset.text ? <a href={asset.text} target="_blank" rel="noreferrer">{asset.license}</a> : <span>{asset.license}</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="about-body">
        <h2>Code</h2>
        {packages === null ? null : packages.length === 0 ? (
          <p>The list of open-source packages is written by the build.</p>
        ) : (
          <>
            <ul className="license-list">
              {packages.map((pkg) => (
                <li key={pkg.name}>
                  <span>
                    <a href={pkg.url} target="_blank" rel="noreferrer">{pkg.name}</a> {pkg.version}
                  </span>
                  <span>{pkg.license}</span>
                </li>
              ))}
            </ul>
            <p>
              <a href={PACKAGES_TEXT} target="_blank" rel="noreferrer">Full license texts</a>
            </p>
          </>
        )}
      </div>
    </section>
  );
}
