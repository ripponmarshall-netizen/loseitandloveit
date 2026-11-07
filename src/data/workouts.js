// Starter routines. Tap one to pre-fill the form, then adjust and save.
// Edit freely: these are sensible defaults, not a programme.

export const HOME_PRESETS = [
  {
    name: '15-min station circuit',
    activity: 'bodyweight',
    intensity: 'moderate',
    duration_min: 15,
    exercises: [
      { name: 'Squats', sets: 3, reps: '12' },
      { name: 'Push-ups (knees if needed)', sets: 3, reps: '8–10' },
      { name: 'Reverse lunges', sets: 3, reps: '10 each leg' },
      { name: 'Plank', sets: 3, reps: '30s' },
      { name: 'Jumping jacks', sets: 3, reps: '20' },
    ],
  },
  {
    name: '20-min full body, no equipment',
    activity: 'bodyweight',
    intensity: 'hard',
    duration_min: 20,
    exercises: [
      { name: 'Squats', sets: 4, reps: '15' },
      { name: 'Push-ups', sets: 4, reps: '10' },
      { name: 'Glute bridges', sets: 4, reps: '12' },
      { name: 'Burpees', sets: 4, reps: '8' },
      { name: 'Mountain climbers', sets: 4, reps: '30s' },
    ],
  },
  {
    name: 'Dumbbell strength',
    activity: 'weights',
    intensity: 'moderate',
    duration_min: 30,
    exercises: [
      { name: 'Goblet squat', sets: 3, reps: '10' },
      { name: 'One-arm row', sets: 3, reps: '10 each' },
      { name: 'Floor press', sets: 3, reps: '10' },
      { name: 'Romanian deadlift', sets: 3, reps: '10' },
      { name: 'Shoulder press', sets: 3, reps: '12' },
    ],
  },
  {
    name: 'HIIT 12 minutes',
    activity: 'hiit',
    intensity: 'hard',
    duration_min: 12,
    exercises: [
      { name: '40s on / 20s off: burpees, high knees, squat jumps, mountain climbers', sets: 3, reps: '4 moves' },
    ],
  },
  {
    name: 'Skipping intervals',
    activity: 'skipping',
    intensity: 'moderate',
    duration_min: 12,
    exercises: [{ name: 'Skip 30s, rest 40s', sets: 10, reps: '30s' }],
  },
  {
    name: '10-min mobility after shift',
    activity: 'mobility',
    intensity: 'light',
    duration_min: 10,
    exercises: [
      { name: 'Cat–cow', sets: 1, reps: '10' },
      { name: 'Hip flexor stretch', sets: 1, reps: '45s each' },
      { name: 'Hamstring stretch', sets: 1, reps: '45s each' },
      { name: 'Thoracic rotations', sets: 1, reps: '8 each' },
      { name: "Child's pose", sets: 1, reps: '60s' },
    ],
  },
]

// Speeds in km/h (the form converts to mph for imperial users).
export const TREADMILL_PRESETS = [
  { name: 'Brisk walk', duration_min: 30, speed_kmh: 5.6, incline_pct: 1, mode: 'walk' },
  { name: 'Incline walk', duration_min: 30, speed_kmh: 4.8, incline_pct: 12, mode: 'walk' },
  { name: 'Walk/jog intervals', duration_min: 25, speed_kmh: 7.2, incline_pct: 1, mode: 'run' },
  { name: 'Easy run', duration_min: 20, speed_kmh: 9.0, incline_pct: 1, mode: 'run' },
]
