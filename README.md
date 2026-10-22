# Crab Farm

A tiny pixel farm that lives in a side pane of Claude Code and keeps you company while Claude works.

![Crab Farm by day and by night](docs/preview.png)

Every step Claude works through gets its own little crab-Claude on its own plot, up to six at a time. Subagents spawned during a step are mini Claudes working on that plot. Crops grow while a step is worked on and ripen when it's done, and the farm follows your clock from dawn to night (with fireflies).

It's purely visual. It never calls a model and adds no tools, so it costs no usage.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install crab-farm --marketplace Adiezc/crab-farm
```

Answer `y` to add the marketplace, then pick a scope (user is the default). The farm opens in a pane straight away.

From a shell instead:

```bash
claude plugin install crab-farm --marketplace Adiezc/crab-farm
```

In the Claude desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `Adiezc/crab-farm`, then **Add plugin**.

## Use

- The pane opens with each session. `/farm` hides it or brings it back.
- **One Claude per step.** The farm follows Claude's task list, the steps the desktop app shows under each message. A plan of eight shows six plots at a time, keeping the step in progress in view. A turn with no plan is one step, named after your prompt.
- **Helpers.** Each running subagent is a mini Claude on the plot of the step that was in progress when it was spawned, coloured by model (Haiku, Sonnet, Opus, Fable). Up to three show per plot, then `+N`.
- **States.** Typing at a laptop: the step in progress. A `?` bubble: waiting for you. Dozing by ripe crops: a finished step. Standing by an empty plot: next up.
- **The board** counts tasks, steps done, helpers and your harvest (kept across sessions). Its lamp is green while Claude works.
- In a plain terminal, where panes can't draw pictures, the same farm shows as a few lines of text.

## Light by design

- No model calls, no tools for the model, no network.
- State is written only when the picture would change. A subagent's tool calls don't redraw anything.
- Only the busy Claude animates; finished ones are still images. Animations stop under reduced motion.

## Develop

```bash
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

The farm is drawn in [hooks/register.tsx](hooks/register.tsx); the sprites live in [hooks/art.ts](hooks/art.ts).

## Credits

The farm art (meadow, trees, barn, pond, plots, critters, helpers, laptops, crops and bubble icons) comes from [clodfarm](https://github.com/matank001/clodfarm) by matank001 / Duke Security, used under its MIT licence. Go and look at it: Crab Farm is a small fan-made side pane built on its look. Details in [CREDITS.md](CREDITS.md).

## License

[MIT](LICENSE) © 2026 Adrian Diez Cuadrado
