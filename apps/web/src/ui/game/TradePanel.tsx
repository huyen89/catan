import { useState } from 'react';
import {
  RESOURCES,
  hasResources,
  type PlayerView,
  type Resource,
  type ResourceCounts,
  type TradeOffer,
} from '@hexhaven/engine';
import { canDo } from '../../game/highlights';
import { RESOURCE_LABEL } from '../../game/labels';
import {
  acceptedSeats,
  counterDraft,
  draftProblem,
  draftToAction,
  emptyDraft,
  maritimeGiveOptions,
  myResponse,
  offerRole,
  toggleRecipient,
  type TradeDraft,
} from '../../game/trade';
import { useGameStore } from '../../store/game';
import { ResourceChoice, ResourceCounter } from '../common';
import { ResourceIcon } from '../icons';
import { useSeatMeta } from './seats';

function CountsInline({ counts }: { counts: ResourceCounts }) {
  const items = RESOURCES.filter((r) => counts[r] > 0);
  if (!items.length) return <span className="muted">nothing</span>;
  return (
    <span className="counts-inline">
      {items.map((r) => (
        <span key={r} className="count-item" title={RESOURCE_LABEL[r]}>
          {counts[r]}
          <ResourceIcon res={r} size={16} />
        </span>
      ))}
    </span>
  );
}

function BankTrade({ view, busy }: { view: PlayerView; busy: boolean }) {
  const send = useGameStore((s) => s.send);
  const [give, setGive] = useState<Resource | null>(null);
  const [get, setGet] = useState<Resource | null>(null);
  const legal = view.legal;
  const me = view.viewer !== null ? view.players[view.viewer] : undefined;
  if (!legal || !me) return null;
  const allowed = canDo(view, 'MARITIME_TRADE');
  const options = maritimeGiveOptions(me.resources, legal.maritimeRatios);

  const confirm = async () => {
    if (!give || !get) return;
    if (await send({ type: 'MARITIME_TRADE', give, get })) {
      setGive(null);
      setGet(null);
    }
  };

  return (
    <div className="bank-trade">
      <h3>Bank trade</h3>
      <div className="row-label">Give</div>
      <ResourceChoice
        label="Give to the bank"
        testPrefix="bank-trade-give"
        value={give}
        onChange={setGive}
        isDisabled={(r) => !allowed || busy || !options.includes(r)}
        note={(r) => `${legal.maritimeRatios[r]}:1`}
      />
      <div className="row-label">Get</div>
      <ResourceChoice
        label="Get from the bank"
        testPrefix="bank-trade-get"
        value={get}
        onChange={setGet}
        isDisabled={(r) => !allowed || busy || r === give || view.bank[r] <= 0}
      />
      <button
        type="button"
        data-testid="bank-trade-confirm"
        disabled={!allowed || busy || !give || !get || give === get}
        onClick={confirm}
      >
        {give && get
          ? `Trade ${legal.maritimeRatios[give]} ${RESOURCE_LABEL[give]} for 1 ${RESOURCE_LABEL[get]}`
          : 'Trade with bank'}
      </button>
    </div>
  );
}

function Composer(props: {
  view: PlayerView;
  busy: boolean;
  draft: TradeDraft;
  setDraft(d: TradeDraft): void;
}) {
  const { view, busy, draft, setDraft } = props;
  const send = useGameStore((s) => s.send);
  const { nameOf, colorOf } = useSeatMeta();
  const me = view.viewer!;
  const hand = view.players[me]?.resources;
  const others = view.players.map((p) => p.seat).filter((s) => s !== me);
  const problem = draftProblem(draft, hand);
  const recipients = draft.to ?? others;

  const submit = async () => {
    if (await send(draftToAction(draft))) setDraft(emptyDraft());
  };

  return (
    <div className="composer">
      <h3>{draft.counterTo !== null ? `Counter-offer to #${draft.counterTo}` : 'Offer a trade'}</h3>
      <div className="row-label">You give</div>
      <ResourceCounter
        label="You give"
        testPrefix="trade-give"
        counts={draft.give}
        max={hand}
        onChange={(give) => setDraft({ ...draft, give })}
        disabled={busy}
      />
      <div className="row-label">You want</div>
      <ResourceCounter
        label="You want"
        testPrefix="trade-want"
        counts={draft.want}
        onChange={(want) => setDraft({ ...draft, want })}
        disabled={busy}
      />
      {draft.counterTo === null && (
        <div className="recipients" role="group" aria-label="Send to">
          <span className="row-label">To</span>
          <button
            type="button"
            className={draft.to === null ? 'chip selected' : 'chip'}
            aria-pressed={draft.to === null}
            onClick={() => setDraft({ ...draft, to: null })}
          >
            Everyone
          </button>
          {others.map((s) => (
            <button
              key={s}
              type="button"
              className={draft.to !== null && recipients.includes(s) ? 'chip selected' : 'chip'}
              aria-pressed={draft.to !== null && recipients.includes(s)}
              data-testid={`trade-to-${s}`}
              style={{ ['--seat-color' as string]: colorOf(s) }}
              onClick={() =>
                setDraft({
                  ...draft,
                  to: draft.to === null ? [s] : toggleRecipient(draft.to, s, others),
                })
              }
            >
              <span className="dot" aria-hidden="true" />
              {nameOf(s)}
            </button>
          ))}
        </div>
      )}
      <div className="actions">
        <button
          type="button"
          data-testid="trade-send"
          disabled={busy || problem !== null}
          title={problem ?? undefined}
          onClick={submit}
        >
          {draft.counterTo !== null ? 'Send counter-offer' : 'Send offer'}
        </button>
        <button type="button" className="ghost" onClick={() => setDraft(emptyDraft())}>
          Clear
        </button>
      </div>
      {problem && <p className="hint">{problem}</p>}
    </div>
  );
}

function OfferCard(props: {
  offer: TradeOffer;
  view: PlayerView;
  busy: boolean;
  onCounter(o: TradeOffer): void;
}) {
  const { offer, view, busy } = props;
  const send = useGameStore((s) => s.send);
  const { nameOf, colorOf } = useSeatMeta();
  const me = view.viewer;
  const role = offerRole(offer, me);
  const hand = me !== null ? view.players[me]?.resources : undefined;
  const mine = myResponse(offer, me);
  const accepters = acceptedSeats(offer);
  const canCounter = canDo(view, 'OFFER_TRADE') || view.turn.current !== me;

  return (
    <li
      className={`offer ${role}`}
      data-testid={`trade-offer-${offer.id}`}
      style={{ ['--seat-color' as string]: colorOf(offer.from) }}
    >
      <div className="offer-head">
        <span className="dot" aria-hidden="true" />
        <strong>{role === 'mine' ? 'Your offer' : nameOf(offer.from)}</strong>
        {offer.counterTo !== null && <span className="badge">counter to #{offer.counterTo}</span>}
        <span className="muted">#{offer.id}</span>
      </div>
      {role === 'toMe' ? (
        <div className="offer-body">
          <div>
            You give <CountsInline counts={offer.want} />
          </div>
          <div>
            You get <CountsInline counts={offer.give} />
          </div>
        </div>
      ) : (
        <div className="offer-body">
          <div>
            Gives <CountsInline counts={offer.give} />
          </div>
          <div>
            Wants <CountsInline counts={offer.want} />
          </div>
        </div>
      )}

      {role === 'toMe' && (
        <div className="actions">
          <button
            type="button"
            data-testid={`trade-accept-${offer.id}`}
            disabled={busy || mine === 'accept' || !hand || !hasResources(hand, offer.want)}
            onClick={() => send({ type: 'RESPOND_TRADE', offerId: offer.id, response: 'accept' })}
          >
            Accept
          </button>
          <button
            type="button"
            className="ghost"
            data-testid={`trade-reject-${offer.id}`}
            disabled={busy || mine === 'reject'}
            onClick={() => send({ type: 'RESPOND_TRADE', offerId: offer.id, response: 'reject' })}
          >
            Reject
          </button>
          {canCounter && (
            <button
              type="button"
              className="ghost"
              data-testid={`trade-counter-${offer.id}`}
              disabled={busy}
              onClick={() => props.onCounter(offer)}
            >
              Counter
            </button>
          )}
          {mine && mine !== 'pending' && <span className="muted">You {mine}ed</span>}
        </div>
      )}

      {(role === 'mine' || role === 'other') && (
        <ul className="responses">
          {Object.entries(offer.responses).map(([s, r]) => {
            const seat = Number(s);
            return (
              <li key={s} className={`resp ${r}`}>
                <span>{nameOf(seat)}</span>
                <span className="resp-state">{r}</span>
                {role === 'mine' && r === 'accept' && (
                  <button
                    type="button"
                    data-testid={`trade-confirm-${offer.id}-${seat}`}
                    disabled={busy}
                    onClick={() => send({ type: 'CONFIRM_TRADE', offerId: offer.id, with: seat })}
                  >
                    Trade with {nameOf(seat)}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {role === 'mine' && (
        <div className="actions">
          {accepters.length === 0 && <span className="muted">Waiting for answers…</span>}
          <button
            type="button"
            className="ghost"
            data-testid={`trade-cancel-${offer.id}`}
            disabled={busy}
            onClick={() => send({ type: 'CANCEL_TRADE', offerId: offer.id })}
          >
            Cancel offer
          </button>
        </div>
      )}
    </li>
  );
}

export function TradePanel({ view, busy }: { view: PlayerView; busy: boolean }) {
  const [draft, setDraft] = useState<TradeDraft>(emptyDraft);
  if (view.viewer === null) return null;
  const canOffer = canDo(view, 'OFFER_TRADE');
  const showComposer = canOffer || draft.counterTo !== null;

  return (
    <section className="panel trade" aria-label="Trading">
      <h2>Trade</h2>
      {view.trades.length > 0 && (
        <ul className="offers">
          {view.trades.map((o) => (
            <OfferCard
              key={o.id}
              offer={o}
              view={view}
              busy={busy}
              onCounter={(offer) => setDraft(counterDraft(offer))}
            />
          ))}
        </ul>
      )}
      {showComposer ? (
        <Composer view={view} busy={busy} draft={draft} setDraft={setDraft} />
      ) : (
        <p className="hint">
          {view.turn.current !== view.viewer
            ? 'Only the active player can open trades. You can counter their offers.'
            : view.phase.kind === 'preRoll'
              ? 'Trading opens after you roll.'
              : 'No trading right now.'}
        </p>
      )}
      <BankTrade view={view} busy={busy} />
    </section>
  );
}
