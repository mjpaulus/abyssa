# Sal's sea legs: standing and walking on a rolling tender

Michael, 2026-10-04: "when sal is standing on the raft, he doesnt move with it. He is completely
stable and his feet go through the raft. that is not what it is like to stand on a rocky boat."

Read this alongside `sal-weighted-suit-motion.md` (his gait on the deck in air). That note sets
how a Mark V diver walks on a STILL deck. This one covers what changes when the deck moves.

## What the raft actually does (measured before building, fixed 60 Hz, 60 s per state)

| | calm (storm 0) | moderate (0.5) | full gale (1.0) |
|---|---|---|---|
| roll, p95 | 2.4 deg (max 3.6) | 1.5-1.8 deg (max 2.2) | 4.4 deg (max 6.1) |
| pitch, p95 | 1.9-2.2 deg (max 3.9) | 2.2 deg (max 2.7) | 1.8 deg (max 2.2) |
| roll rate, p95 | 2.5 deg/s | 2.7 deg/s | 3.1 deg/s (max 5.6) |
| roll half-period, median | 3.2 s | 4.3 s | 4.2 s |
| heave range | 0.77 u | 0.91 u | 2.2 u (-0.57..+1.62) |
| heave accel, p95 | 0.15-0.19 u/s^2 | 0.21-0.27 | 0.27-0.38 |
| surge (x sway), amplitude | 0.16 u | 0.33 u | 0.50 u |

The raft follows the waves' slope (updateRaft averages the sea under the hull), so a gale rolls it
about 5 deg, not the 20 deg a narrow hull would. It is a slow roll at about 0.1 Hz. The swell never
fully stops: a "calm" day still pitches and rolls 2-4 deg, so the fix has to hold in every state.

Before this pass Sal stood on a flat plane at `raft.position.y + 0.11` and ignored the tilt. In a gale
a planted boot went **26 cm through the planks** (p05 -23 cm) or **floated 25 cm above them**, and
he slid up to **0.53 u** across the deck, which moved under him in world space. Calm: -16 / +16 cm and
0.32 u. Moderate: -10 / +15 cm and 0.48 u.

## What the reference says

### Standing at sea, general
- Getting your sea legs is a measurable change in posture. Novices on a 180 m ship in Beaufort 4-5
  **widened their stance** (land 17.0 cm heel to heel) within the first hours. Nobody told them to,
  and stance angle did not change. Experienced mariners show the same widening at sea, and their sway
  is larger in fore-aft than side to side. [Stoffregen et al. 2013, *Getting Your Sea Legs*, PLOS ONE;
  Stoffregen, Chen, Yu & Villard 2009, *Standing posture on land and at sea*]
- Wider stance reduces body sway at sea (tested at 5, 17 and 30 cm). [Stoffregen et al., *Body sway at
  sea for two visual tasks and three stance widths*]
- People couple their postural sway to the ship's motion. They do not hold rigid; they move with it
  and against it. [Varlet et al. 2015, *Coupling of postural activity with motion of a ship at sea*]
- Frequency decides the strategy. On a support moved slowly (0.1-0.25 Hz) people **ride** it: the
  body goes with the platform as a unit. At about 1 Hz the head and trunk stay fixed in space while the
  legs take the motion. Vision damps head motion. [Buchanan & Horak 1999, J Neurophysiol 81:2325]
  The raft rolls at about 0.1 Hz, so Sal mostly rides with small lagging corrections. The heave and
  slap chop sit in the faster band, and there the legs absorb the motion and the trunk stays put.
- Motion-induced interruptions (MII), the naval-architecture model of standing on a deck. You **tip**
  when the lateral force at deck level beats the righting moment of your stance. The tipping
  coefficient is (half stance width incl. shoe) / (CoG height), **0.25** for a standing sailor
  (l = 0.23 m, h = 0.91 m). Deck inclination combined with lateral and vertical acceleration is what
  matters. **Vertical acceleration changes the budget**: a deck falling away (heave down) unweights
  you and lowers the threshold, and a rising deck loads you. The MII responses are tipping (a step or
  stumble), sliding, and lift-off; the fix is to brace, step, or grab something firm.
  [Graham 1990; Crossland & Rich; Crossland et al. 2008, *Motion-induced interruptions aboard ship*,
  Occupational Ergonomics; NPS thesis on MII assessment]
- Seamanship: "one hand for yourself, one for the ship". Knees soft, weight low, feet apart, and
  walk timed to the roll so you step when the deck comes level, not while it falls away. (Common
  practice; it agrees with the MII model: step while the lateral and vertical loads favour you.)

### A dressed Mark V on a diving tender
- About 90 kg of dress: helmet and breastplate 25 kg, belt 38 kg, **each shoe 7.9 kg (17.5 lb)**,
  dress 5.5 kg. [US Naval Undersea Museum; Divers Institute of Technology; existing gait spec]
- On deck he hardly walks at all. He is dressed **seated on the dressing stool**, and with tenders'
  help walks "the three or four steps from the dressing stool to the stairs". The walk to the ladder is
  slow, assisted, and felt as weight on the shoulders and pull from the lines. He cannot dress himself
  and needs tenders; a fallen diver needs four people to raise him. [diveamarkv.com; X-Ray Mag *Heavy
  Metal*; 1943 Navy Diving Manual ch. X]
- **Top-heavy**: about 25 kg of copper and brass rides at the shoulders and head, and the helmet is
  bolted to the breastplate (it cannot nod or roll on the neck). Body plus rig CoG sits a little above
  the hips, but the rotational inertia about the soles is far above a sailor's. So his corrections are
  **slow and damped**: the torso-helmet unit moves as one, late, with no wobble.
- 7.9 kg on each foot means **no quick recovery steps**. A boot is shuffled a few centimetres off the
  planks (the existing shuffle lifts 7.5 cm), never snatched up. He absorbs the motion with soft knees
  and steps only when he has to.
- Lead soles on wet wood are high friction; the gale deck tilts about 5 deg (tan 0.09). Sliding needs
  roughly 0.4-0.6. **He does not slide.** The MII tipping budget is what runs out, not friction.

## Targets (derived)

Sal's numbers: half stance 0.285 (HIP_X 0.225 + deck wide 0.06), boot half-width about 0.06, CoG about
1.5 u above the soles, so a tipping coefficient of about **0.23**, close to Graham's sailor.

| | calm | gale | why |
|---|---|---|---|
| planted boot to plank gap | 0 +-1 cm | 0 +-1 cm, max 2 cm | the bug |
| drift vs deck, standing | about 0 | at most about 0.3 u, comes back | he rides the deck; tipping makes a step, not a slide |
| stance (half width) | 0.285 | 0.37-0.39 (+30%) | Stoffregen widening; the 30 cm sway test |
| standing knee | 12 deg (shipped kIdle) | 18-22 deg | sea legs: soft knees, CoG low |
| uphill vs downhill knee on a 5 deg roll | equal | uphill 25-35 deg, downhill 4-12 deg | upright to gravity over a sloped stance: 0.055 u height difference over a near-straight leg |
| torso+helmet tilt to gravity | under 0.5 deg | 1-2 deg, lag 0.4-0.6 s, damping 0.9+ | rides a 0.1 Hz roll, top-heavy and bolted, so slow and dead-beat |
| hip-strategy counter-lean | | torso leans against the CoG excursion | hip strategy |
| heave: knee sink on a rise / extend on a drop | 1-2 deg | 5-8 deg / 2-4 deg | MII vertical-accel loading; stylised gain (the sea's 0.04 g is too small to read at 1:1) |
| arms | at sides (deck 15-22 deg out) | out a further 10-20 deg, elbows soft | balance; "one hand for the ship" |
| corrective step | never | when the CoG excursion passes the support margin; a shuffle of a few cm, 0.3-0.4 s | MII tipping; heavy boots |
| stagger | never | rare, on a sharp demand spike: a rock of 3-6 deg and hands briefly off | MII stumble |
| walk on a rolling deck | shipped | top speed -25%, wider, a down-slope lurch, slower when climbing the tilt | timing to the roll |
| camera | level | a few tenths of a degree of the roll, damped (knob) | aboard, the horizon tilts; Michael hates floaty, so tiny |

## Sources
- [Getting Your Sea Legs, Stoffregen et al. 2013, PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0066949)
- [Standing Posture on Land and at Sea, Stoffregen, Chen, Yu & Villard](https://www.researchgate.net/publication/233183211_Standing_Posture_on_Land_and_at_Sea)
- [Body Sway at Sea for Two Visual Tasks and Three Stance Widths](https://researchgate.net/publication/40758353_Body_Sway_at_Sea_for_Two_Visual_Tasks_and_Three_Stance_Widths)
- [Coupling of postural activity with motion of a ship at sea, Varlet et al. 2015](https://link.springer.com/article/10.1007/s00221-015-4235-7)
- [Emergence of Postural Patterns as a Function of Vision and Translation Frequency, Buchanan & Horak 1999](https://journals.physiology.org/doi/full/10.1152/jn.1999.81.5.2325)
- [Motion-Induced Interruptions and Postural Equilibrium in Linear Lateral Accelerations](https://www.researchgate.net/publication/269336415_Motion-Induced_Interruptions_and_Postural_Equilibrium_in_Linear_Lateral_Accelerations)
- [Assessing motion induced interruptions (NPS thesis)](https://core.ac.uk/download/pdf/36730075.pdf)
- [Motion-induced interruptions aboard ship: model development, Crossland et al. 2008](https://content.iospress.com/download/occupational-ergonomics/oer00147?id=occupational-ergonomics%2Foer00147)
- [Mark V, Divers Institute of Technology](https://diversinstitute.edu/programs/suit-up/mark-v/)
- [Your Dive Experience, Dive a Mark V](https://diveamarkv.com/dive/)
- [Heavy Metal: The Hardhat Diving Experience, X-Ray Mag](https://xray-mag.com/content/heavy-metal-hardhat-diving-experience)
- [Diving Manual, 1943, US Navy (Internet Archive)](https://archive.org/details/DivingManual1943)
