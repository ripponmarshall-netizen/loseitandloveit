// Workout types from Apple's Workout and Fitness apps (HealthKit's
// HKWorkoutActivityType names), used by the workout picker and the Apple
// Fitness import.
//
//   met:      typical MET at a moderate effort (Compendium of Physical
//             Activities, rounded). Net kcal = (MET - 1) x kg x hours.
//   home:     maps onto the at-home form (editable there)
//   fallback: the at-home activity a row is saved as if the database hasn't
//             had migration 0006 yet
//   inOut:    Apple splits it into indoor and outdoor
//   variants: names Apple shows in the Workout app, offered in the picker

export const WORKOUT_GROUPS = {
  walkrun: { label: 'Walking & running', icon: 'run', color: 'var(--green)' },
  cycle: { label: 'Cycling', icon: 'bike', color: 'var(--orange)' },
  water: { label: 'Water', icon: 'wave', color: 'var(--cyan)' },
  cardio: { label: 'Gym cardio', icon: 'heart', color: 'var(--pink)' },
  strength: { label: 'Strength', icon: 'dumbbell', color: 'var(--orange)' },
  mind: { label: 'Yoga & mobility', icon: 'leaf', color: 'var(--mint)' },
  dance: { label: 'Dance', icon: 'music', color: 'var(--purple)' },
  combat: { label: 'Combat', icon: 'target', color: 'var(--red)' },
  team: { label: 'Team sports', icon: 'ball', color: 'var(--indigo)' },
  racquet: { label: 'Racquet sports', icon: 'racquet', color: 'var(--teal)' },
  outdoor: { label: 'Outdoors', icon: 'mountain', color: 'var(--green)' },
  winter: { label: 'Snow & ice', icon: 'snow', color: 'var(--blue)' },
  other: { label: 'Other', icon: 'bolt', color: 'var(--text-2)' },
}

const T = (key, label, group, met, extra = {}) => ({ key, label, group, met, fallback: extra.home || (group === 'mind' ? 'mobility' : group === 'strength' ? 'bodyweight' : 'hiit'), ...extra })

export const WORKOUT_TYPES = [
  // Walking & running
  T('Walking', 'Walk', 'walkrun', 3.5, { inOut: true, fallback: 'bodyweight' }),
  T('Running', 'Run', 'walkrun', 9, { inOut: true }),
  T('Hiking', 'Hike', 'walkrun', 6, { fallback: 'bodyweight' }),
  T('WheelchairWalkPace', 'Wheelchair walk pace', 'walkrun', 3.5, { fallback: 'bodyweight' }),
  T('WheelchairRunPace', 'Wheelchair run pace', 'walkrun', 6),
  T('TrackAndField', 'Track and field', 'walkrun', 6),
  // Cycling
  T('Cycling', 'Cycle', 'cycle', 7, { inOut: true }),
  T('HandCycling', 'Hand cycle', 'cycle', 5),
  // Water
  T('Swimming', 'Swim', 'water', 7, { variants: ['Pool swim', 'Open water swim'] }),
  T('WaterFitness', 'Water fitness', 'water', 5.3),
  T('WaterPolo', 'Water polo', 'water', 10),
  T('WaterSports', 'Water sports', 'water', 4),
  T('PaddleSports', 'Paddle sports', 'water', 5),
  T('Rowing', 'Rower', 'water', 7, { variants: ['Rower', 'Outdoor rowing'] }),
  T('Sailing', 'Sailing', 'water', 3),
  T('SurfingSports', 'Surfing', 'water', 3.5),
  T('UnderwaterDiving', 'Underwater diving', 'water', 7),
  T('SwimBikeRun', 'Swim bike run', 'water', 8, { variants: ['Triathlon', 'Duathlon'] }),
  // Gym cardio
  T('Elliptical', 'Elliptical', 'cardio', 5),
  T('StairClimbing', 'Stair stepper', 'cardio', 9),
  T('Stairs', 'Stairs', 'cardio', 8),
  T('StepTraining', 'Step training', 'cardio', 7),
  T('MixedCardio', 'Mixed cardio', 'cardio', 6),
  T('MixedMetabolicCardioTraining', 'Mixed metabolic cardio', 'cardio', 6, { hidden: true }),
  T('HighIntensityIntervalTraining', 'HIIT', 'cardio', 8, { home: 'hiit' }),
  T('JumpRope', 'Jump rope', 'cardio', 11.8, { home: 'skipping' }),
  T('CrossTraining', 'Cross training', 'cardio', 7, { home: 'hiit' }),
  T('FitnessGaming', 'Fitness gaming', 'cardio', 4),
  // Strength
  T('TraditionalStrengthTraining', 'Strength training', 'strength', 5, { home: 'weights', variants: ['Traditional strength training'] }),
  T('FunctionalStrengthTraining', 'Functional strength', 'strength', 5, { home: 'bodyweight', variants: ['Functional strength training'] }),
  T('CoreTraining', 'Core training', 'strength', 4, { home: 'bodyweight' }),
  T('Gymnastics', 'Gymnastics', 'strength', 3.8),
  T('Climbing', 'Climbing', 'strength', 7.5, { variants: ['Climbing', 'Bouldering'] }),
  // Yoga & mobility
  T('Yoga', 'Yoga', 'mind', 2.5, { home: 'mobility' }),
  T('Pilates', 'Pilates', 'mind', 3),
  T('Barre', 'Barre', 'mind', 3.5),
  T('TaiChi', 'Tai chi', 'mind', 3),
  T('Flexibility', 'Flexibility', 'mind', 2.3, { home: 'mobility' }),
  T('Cooldown', 'Cooldown', 'mind', 2.3, { home: 'mobility' }),
  T('MindAndBody', 'Mind and body', 'mind', 2.5, { home: 'mobility' }),
  T('PreparationAndRecovery', 'Preparation and recovery', 'mind', 2.3, { home: 'mobility' }),
  // Dance
  T('CardioDance', 'Dance', 'dance', 6, { variants: ['Dance', 'Cardio dance'] }),
  T('SocialDance', 'Social dance', 'dance', 4.5),
  T('Dance', 'Dance', 'dance', 5, { hidden: true }),
  // Combat
  T('Boxing', 'Boxing', 'combat', 7.8),
  T('Kickboxing', 'Kickboxing', 'combat', 7.3),
  T('MartialArts', 'Martial arts', 'combat', 7.3),
  T('Wrestling', 'Wrestling', 'combat', 6),
  T('Fencing', 'Fencing', 'combat', 6),
  // Team sports
  T('Soccer', 'Football', 'team', 7),
  T('Basketball', 'Basketball', 'team', 6.5),
  T('Cricket', 'Cricket', 'team', 4.8),
  T('Volleyball', 'Volleyball', 'team', 4),
  T('AmericanFootball', 'American football', 'team', 8),
  T('AustralianFootball', 'Australian football', 'team', 8),
  T('Rugby', 'Rugby', 'team', 8.3),
  T('Baseball', 'Baseball', 'team', 5),
  T('Softball', 'Softball', 'team', 5),
  T('Handball', 'Handball', 'team', 8),
  T('Hockey', 'Hockey', 'team', 8),
  T('Lacrosse', 'Lacrosse', 'team', 8),
  T('DiscSports', 'Disc sports', 'team', 3),
  // Racquet sports
  T('Tennis', 'Tennis', 'racquet', 7.3),
  T('TableTennis', 'Table tennis', 'racquet', 4),
  T('Badminton', 'Badminton', 'racquet', 5.5),
  T('Squash', 'Squash', 'racquet', 7.3),
  T('Racquetball', 'Racquetball', 'racquet', 7),
  T('Pickleball', 'Pickleball', 'racquet', 4.1),
  // Outdoors and precision
  T('Golf', 'Golf', 'outdoor', 4.8, { fallback: 'bodyweight' }),
  T('Archery', 'Archery', 'outdoor', 4.3, { fallback: 'bodyweight' }),
  T('Bowling', 'Bowling', 'outdoor', 3, { fallback: 'bodyweight' }),
  T('EquestrianSports', 'Equestrian sports', 'outdoor', 5.5),
  T('Fishing', 'Fishing', 'outdoor', 3.5, { fallback: 'bodyweight' }),
  T('Hunting', 'Hunting', 'outdoor', 5, { fallback: 'bodyweight' }),
  T('Play', 'Play', 'outdoor', 5),
  // Snow and ice
  T('SkatingSports', 'Skating', 'winter', 7),
  T('DownhillSkiing', 'Downhill skiing', 'winter', 5.3),
  T('CrossCountrySkiing', 'Cross-country skiing', 'winter', 9),
  T('Snowboarding', 'Snowboarding', 'winter', 5.3),
  T('SnowSports', 'Snow sports', 'winter', 5.3),
  T('Curling', 'Curling', 'winter', 4),
  // Other
  T('Other', 'Other workout', 'other', 4, { fallback: 'bodyweight' }),
]

export const WORKOUT_TYPE_BY_KEY = Object.fromEntries(WORKOUT_TYPES.map((t) => [t.key, t]))

/**
 * What the picker lists: each type once, or once per Apple variant
 * ("Outdoor walk", "Indoor walk", "Pool swim"...). Sorted within groups.
 */
export const WORKOUT_CHOICES = WORKOUT_TYPES.filter((t) => !t.hidden).flatMap((t) => {
  const names = t.inOut ? [`Outdoor ${t.label.toLowerCase()}`, `Indoor ${t.label.toLowerCase()}`] : t.variants || [t.label]
  return names.map((name) => ({ id: `${t.key}:${name}`, name, type: t }))
})

/** The type for a saved workout's name ("Outdoor cycle" -> Cycling), or null. */
export function workoutTypeForName(name) {
  const n = String(name || '').toLowerCase().trim()
  if (!n) return null
  const hit = WORKOUT_CHOICES.find((c) => c.name.toLowerCase() === n) || WORKOUT_TYPES.find((t) => t.label.toLowerCase() === n)
  return hit ? hit.type || hit : null
}
