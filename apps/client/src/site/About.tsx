import { CHALLENGES, CHALLENGES_URL, GITHUB_URL, HACKATHON_URL, AUDIOTOOL_URL } from './links';
import { Link, PATHS } from './router';

export function About() {
  return (
    <section className="about">
      <div className="about-intro">
        <img
          className="about-record"
          src="/homepage/record.webp"
          alt=""
          width={648}
          height={648}
          aria-hidden="true"
        />
        <div className="about-body">
          <p className="lead">
            <strong>Keep the Beat</strong> is a co-op music game for up to five players. You make a
            track together, and none of you has to know anything about music.
          </p>
          <p>
            You take records from the crates, run them through effects and put them on the deck. Every
            record is a loop from the{' '}
            <a href={AUDIOTOOL_URL} target="_blank" rel="noreferrer">
              Audiotool
            </a>{' '}
            library. When the show ends, each of you can send the track to your own Audiotool account as
            a project, open it and keep going.
          </p>
        </div>
      </div>

      <div className="about-body">
        <h2>Let’s Build 2026</h2>
        <p>
          Made for{' '}
          <a href={HACKATHON_URL} target="_blank" rel="noreferrer">
            Let’s Build
          </a>
          , Audiotool’s hackathon. Entered in{' '}
          <a href={CHALLENGES_URL} target="_blank" rel="noreferrer">
            {CHALLENGES.slice(0, -1).join(', ')} and {CHALLENGES.at(-1)}
          </a>
          .
        </p>
      </div>

      <div className="about-body">
        <h2>Made with</h2>
        <ul className="license-list">
          <li><strong>Characters and animations</strong><span>Quaternius</span></li>
          <li><strong>Loops</strong><span>Audiotool</span></li>
          <li><strong>Disco ball</strong><span>Cough-E</span></li>
          <li><strong>Font</strong><span>Space Grotesk, Florian Karsten</span></li>
          <li><strong>Pitch shifting</strong><span>Signalsmith Stretch</span></li>
        </ul>
        <p>
          <Link to={PATHS.licenses}>Licenses</Link>
          {' · '}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </p>
      </div>
    </section>
  );
}
