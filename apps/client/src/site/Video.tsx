import { useState } from 'react';
import { Icon } from '../overlay/icons';
import { VIDEO_ID } from './links';

export function Video() {
  const [playing, setPlaying] = useState(false);

  return (
    <section className="watch" id="video">
      <div className="watch-frame">
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0`}
            title="Keep the Beat, the video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <button type="button" className="watch-cover" onClick={() => setPlaying(true)} aria-label="Play the video">
            <img src="/homepage/video-cover.webp" alt="" width={1600} height={900} loading="lazy" decoding="async" />
            <span className="watch-play">
              <Icon name="play" />
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
