import { useHandsetSideways } from '../game/handset';
import { Icon } from '../overlay/icons';

export function TurnUpright() {
  const sideways = useHandsetSideways();
  if (!sideways) return null;
  return (
    <div className="turn-upright" role="alertdialog" aria-live="assertive" aria-label="Turn your phone upright">
      <Icon name="phone" className="turn-upright-phone" />
      <p>Turn your phone upright</p>
    </div>
  );
}
