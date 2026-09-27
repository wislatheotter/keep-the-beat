import { useEffect } from 'react';
import { CONTACT_EMAIL } from './links';

const UPDATED = '27 September 2026';

export const AUDIOTOOL_SECTION = 'audiotool';

export function Privacy() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);

  return (
    <section className="about privacy">
      <div className="about-intro">
        <p className="kicker">Updated {UPDATED}</p>
        <h1 className="display">
          Privacy
          <br />
          policy<span className="dot">.</span>
        </h1>
      </div>

      <div className="about-body" id={AUDIOTOOL_SECTION}>
        <p>
          Keep the Beat is run by Wisla the Otter: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
        <p>
          To run the game you ask to play, we process your IP address, what you do in the game, and your
          Audiotool username and profile name, which Audiotool gives us when you sign in.
        </p>
        <p>
          Players in your room see your profile name and what you do. Our server (Heroku, EU) keeps this only
          while your room is open, and IP addresses in its logs for up to a week.
        </p>
        <p>
          If you play the video on the front page, it comes from YouTube (Google), which then receives your IP
          address and what your browser tells it.
        </p>
        <p>
          You can ask to see, correct, delete or get a copy of your data, or to limit or object to its use,
          and you can complain to a data protection authority.
        </p>
        <p>You must be at least 13 to play.</p>
      </div>
    </section>
  );
}
