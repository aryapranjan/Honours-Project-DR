# Study Design

Status: implementation specification with pilot-dependent parameters identified

Last reconciled: 2026-07-20

## Research Aim

The study investigates whether diminished reality can reduce distraction during
a co-located collaborative physical task, and whether symmetric and asymmetric
DR configurations affect:

- task completion;
- construction accuracy;
- communication and coordination;
- perceived distraction;
- workload;
- trust in the DR system; and
- perceived visual quality and stability.

Tangram is used as a controlled collaborative visuospatial construction task.
It is not treated as a standardized diagnostic test or as a pure measure of
visual attention.

## Design Summary

- Unit of participation: one two-person dyad
- Location: one fixed physical study room
- Hardware: two Quest 3 headsets and one experimenter MacBook
- Primary task: Director-guided physical tangram construction
- Maximum trial duration: 420 seconds
- Practice trials: one, unscored
- Scored trials: six per dyad before technical replacements
- DR configurations: three, within dyad
- Distractor types: two within each DR configuration
- Roles: fixed within dyad
- Asymmetric recipient: counterbalanced between dyads
- Condition, distractor, and puzzle order: counterbalanced

The analysis must account for repeated observations within dyads. Individual
participants from the same pair are not independent observations.

## Participant Roles

### Director

- Receives one private printed target card.
- Can see the Builder's workspace and construction.
- May speak and answer questions.
- Must not reveal the card.
- Must not point, gesture, touch pieces, or physically guide the Builder.

### Builder

- Cannot see the target card.
- Is the only person permitted to manipulate the seven tangram pieces.
- May ask questions and discuss the construction.
- Verbally says `submit` when satisfied.

### Experimenter

- Operates the laptop dashboard.
- Confirms the physical preflight checklist.
- Starts the guarded trial.
- Records the Builder's verbal submission.
- Uses only standardized feedback.
- Stops or invalidates trials according to predefined rules.
- Does not provide task-solving help.

## Experimental Factors

### DR configuration

| Code | Director | Builder |
|---|---|---|
| `NO_DR` | Unmodified view | Unmodified view |
| `SYMMETRIC_DR` | Intended distractor diminished | Intended distractor diminished |
| `ASYMMETRIC_DR_DIRECTOR` | Intended distractor diminished | Unmodified view |
| `ASYMMETRIC_DR_BUILDER` | Unmodified view | Intended distractor diminished |

The schedule uses one asymmetric recipient for a pair. Across the sample, the
two asymmetric forms are balanced.

### Distractor type

| Code | Active distractor | Inactive distractor | Audio |
|---|---|---|---|
| `TV_HIGH_MOTION` | Standardized football video | Keyboard RGB off | Muted |
| `KEYBOARD_SLOW_RGB` | Slow low-brightness cycle | TV black or off | None |

The study must not claim that the two distractors differ only in salience.
Post-trial ratings and pilot testing verify whether the intended salience
ordering was perceived.

## Trial Count

The planned scored set for each dyad is:

| DR configuration | TV trial | Keyboard trial | Total |
|---|---:|---:|---:|
| No DR | 1 | 1 | 2 |
| Symmetric DR | 1 | 1 | 2 |
| Asymmetric DR | 1 | 1 | 2 |
| **Total** | **3** | **3** | **6** |

One additional practice puzzle is required. Reserve puzzles are held outside
the planned six and are used only for approved replacement trials.

## Counterbalancing

The schedule must be generated and validated before participant collection.
It should balance:

- Director and Builder role assignment;
- asymmetric DR recipient;
- DR configuration order;
- TV versus keyboard order within configuration;
- puzzle-to-condition mapping; and
- puzzle serial position.

A Latin-square or equivalent balanced schedule may be used for DR
configuration order. Puzzle assignment must be rotated independently so no
puzzle is systematically associated with one condition.

The schedule file must include:

- schedule version;
- randomization seed;
- pair allocation;
- role allocation;
- asymmetric recipient;
- ordered trial list;
- puzzle IDs;
- reserve puzzle IDs; and
- validation result.

## Tangram Materials

### Locked requirements

- Seven physical pieces
- One standardized piece set for all trials
- Builder-only manipulation
- Fixed construction workspace
- Private printed Director target
- Overhead recording of the workspace

### Recommended accessible implementation

- Completed square scale approximately `25-30 cm`
- Lightweight pieces approximately `3-5 mm` thick
- Matte finish to limit passthrough glare
- High-contrast piece edges
- No requirement to identify pieces by colour
- Non-slip construction surface
- Clearly marked workspace orientation
- Adjustable left- or right-handed starting layout

Whether the Director's card shows internal piece boundaries is deferred. Showing
boundaries reduces Director-side puzzle solving and isolates communication;
showing only a silhouette increases insight-solving demand. The final choice
must be held constant and documented.

## Standard Trial Procedure

1. The server loads the scheduled trial.
2. Both Quests receive `PREPARE_TRIAL`.
3. Each Quest validates role, target, DR state, calibration, app version, and
   device health.
4. Both Quests return `READY`.
5. The experimenter checks:
   - correct target card;
   - card privacy;
   - standardized piece reset;
   - TV state;
   - keyboard state;
   - lighting;
   - overhead camera;
   - both microphones;
   - storage;
   - batteries.
6. The laptop sends `COMMIT_START` with a synchronized future time.
7. Both Quests acknowledge.
8. OBS recording and stimulus state are confirmed.
9. The authoritative 420-second timer starts.
10. The pair communicates and the Builder constructs the figure.
11. The Builder says `submit`.
12. The experimenter records Submit.
13. If incorrect and time remains, the experimenter says only `Continue`. The
    attempt is logged, the timer does not pause, and the pair may submit again.
14. The trial ends on correct completion, timeout, approved abort, or technical
    invalidation.
15. The system validates expected event and media artifacts.
16. Short post-trial ratings are completed for scored trials.

The practice trial follows the same system path using `NO_DR` with the keyboard
distractor. It is marked `PRACTICE` and excluded from scored exports and scored
post-trial ratings.

## Completion and Scoring

### Runtime outcome

The experimenter records:

- correct completion;
- incorrect submission followed by continuation;
- timeout;
- participant withdrawal;
- protocol deviation;
- technical invalidation; or
- experimenter abort.

### Objective post-hoc scoring

The overhead recording supplies the final arrangement. The scoring protocol
should record:

- all seven pieces present;
- correct piece identity and orientation;
- position error;
- rotation error;
- flipped parallelogram where relevant;
- overall binary correctness; and
- rater confidence.

The exact geometric tolerance is pilot-dependent. It must be fixed before the
main study and applied without knowledge of condition where practical.

A subset should be independently scored by a second rater so agreement can be
reported.

## Outcome Measures

### Primary behavioral outcomes

- Correct completion within 420 seconds
- Completion time
- Objective final-arrangement accuracy

### Secondary behavioral outcomes

- Number and timing of submissions
- Clarification questions
- Correction or repair sequences
- Director and Builder speaking time
- Turn count
- Overlapping speech
- Protocol deviations
- Approximate head orientation toward distractors

Head orientation is an attention proxy and must not be described as eye gaze.

### Subjective outcomes

After each trial:

- distractor noticeability;
- perceived distraction;
- task difficulty;
- communication difficulty;
- confidence in the submitted construction;
- DR realism, when applicable;
- DR stability, when applicable; and
- visual discomfort.

After each condition block:

- NASA-TLX workload;
- trust in DR;
- perceived coordination quality; and
- perceived usefulness or disruption.

After the session:

- condition preference;
- perceived effect of DR;
- qualitative comments; and
- simulator discomfort symptoms.

Questionnaire wording, scale length, timing, and hardware remain to be finalized
before participant collection.

## Validity Controls

- Use one practice trial.
- Use different puzzles rather than repeating the same target.
- Pilot puzzle difficulty.
- Counterbalance condition order and puzzle mapping.
- Hold distractor content and physical positions constant.
- Ensure only one distractor is active.
- Use a standardized muted TV segment.
- Use a standardized keyboard effect.
- Keep lighting fixed and record deviations.
- Define scoring tolerances before the main study.
- Keep experimenter feedback scripted.
- Record technical failures without deletion.
- Include perceived-salience manipulation checks.
- Analyze repeated data at the dyad level or with an appropriate hierarchical
  model.

## Accessibility and Safety

- Use plain-language written and spoken instructions.
- Demonstrate the task with a non-study puzzle.
- Run a practice comprehension check.
- Support prescription glasses using the appropriate Quest spacer.
- Allow seating and piece-layout adjustment without changing sight lines.
- Keep the task controller-free for participants.
- Permit breaks between blocks.
- Stop immediately for discomfort or withdrawal.
- Record accommodations that could affect task performance.

## Pilot Exit Criteria

Before the main study, pilot testing must establish:

- most puzzles are solvable within the trial window;
- no severe floor or ceiling effect;
- matched puzzle difficulty bands;
- stable calibration for both headsets;
- acceptable DR alignment;
- TV and keyboard perceived-salience distributions;
- objective scoring tolerance;
- acceptable questionnaire duration;
- reliable media capture;
- acceptable network latency and recovery; and
- a final room and seating layout.

## Methodological References

- Clark, H. H., and Wilkes-Gibbs, D. (1986). Referring as a collaborative
  process. Cognition, 22(1), 1-39.
  https://doi.org/10.1016/0010-0277(86)90010-7
- Hawkins, R. D., Frank, M. C., and Goodman, N. D. (2020). Characterizing the
  dynamics of learning in repeated reference games. Cognitive Science, 44(6).
  https://doi.org/10.1111/cogs.12845
- NASA Task Load Index:
  https://www.nasa.gov/human-systems-integration-division/nasa-task-load-index-tlx/
