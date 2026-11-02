# Rule decisions

The engine implements these rules. Tests reference the section names below.

## Setup

- Snake draft: seats 0..n-1 each place a settlement and then a road touching it, then n-1..0 do the same.
- The second settlement yields 1 resource for each adjacent producing hex.
- The robber starts on a desert. For 5–6 players, the first desert in board order is used.

## Turn

- `preRoll`: the player may play a knight, then must `ROLL`.
- Roll of 2–6 or 8–12: every settlement adjacent to a hex with that number (unless the robber is on it) gives 1 card, and every city gives 2.
  - **Bank shortage:** if the bank cannot pay every player owed a resource, nobody receives it. Exception: when only one player is owed it, that player receives what remains.
- Roll of 7:
  1. Each player holding more than `discardLimit` cards discards `floor(n/2)`. Discards happen simultaneously, in any order.
  2. The roller moves the robber to a different hex.
  3. The roller steals 1 random card from an opponent who has a building on that hex and holds cards. The steal step is skipped when there is no such opponent.
- `main`: build, buy, trade, and play at most one dev card (not one bought this turn). VP cards are never played. They count in secret and are revealed at game over.
- Knight or road building played before the roll: after resolving, the player returns to `preRoll`. Knight is the only dev card allowed before the roll.

## Building

- Distance rule: no settlement may sit next to another settlement or city.
- Placement after setup:
  - A settlement must touch one of the player's own roads.
  - A road must touch one of the player's own roads or buildings, and may not pass through an opponent's building.
- Piece limits: 15 roads, 5 settlements, 4 cities. Upgrading to a city returns the settlement piece.

## Development cards

- **Knight:** move the robber and steal.
- **Road building:** 2 free roads, or fewer if the player has fewer left or no legal edge exists.
- **Year of plenty:** take any 2 resources from the bank.
- **Monopoly:** every opponent gives the player all their cards of one resource.

## Awards (2 VP each)

- **Longest road:** the longest trail (no edge reused) of at least 5 roads. An opponent's building on a vertex breaks the trail there.
  - The holder keeps the award on a tie.
  - If the holder's road is broken and no single player has the strictly longest road of at least 5, nobody holds the award.
- **Largest army:** at least 3 played knights, strictly more than the current holder.

## Trading

- **Maritime:** 4:1 by default, 3:1 with a generic port, 2:1 with a matching resource port. Only the active player, in `main`.
- **Domestic:**
  - The active player may `OFFER_TRADE` to everyone or to chosen seats.
  - Recipients reply `accept` or `reject`, and the offerer `CONFIRM_TRADE`s with one accepter. Hands are revalidated at that point.
  - A non-active player may send a counter-offer to the active player only (`counterTo` set). If the active player accepts it, the trade executes immediately.
  - All offers close at `END_TURN`. Giving resources away for nothing is not allowed: both sides must be non-empty.

## Five or six players

- Board: 30 hexes, 11 ports, 34 dev cards, 24 cards of each resource in the bank.
- Special Building Phase: after each `END_TURN`, every other player in turn order may build or buy dev cards. No trading and no dev card play during this phase. Each player passes with `PASS_SPECIAL_BUILD`.

## Winning

- A player wins on reaching `vpToWin` (default 10) during their own turn.
- A player who reaches it during another player's turn (for example in the Special Building Phase) wins at the start of their own turn.
