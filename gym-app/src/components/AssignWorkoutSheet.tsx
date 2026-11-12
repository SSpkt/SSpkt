import { useState } from 'react';

import { assignWorkout } from '@/lib/api';
import type { Workout } from '@/lib/database.types';
import { friendlyError } from '@/lib/errors';
import { limits, validateWorkoutNotes, validateWorkoutTitle } from '@/lib/validation';

import { Sheet } from './Sheet';
import { Banner, Button, TextField } from './ui';

export function AssignWorkoutSheet({
  client,
  trainerId,
  onClose,
  onAssigned,
}: {
  /** The sheet is open while a client is set. */
  client: { id: string; name: string } | null;
  trainerId: string;
  onClose: () => void;
  onAssigned: (workout: Workout) => void;
}) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleError = validateWorkoutTitle(title);
  const notesError = validateWorkoutNotes(notes);

  function reset() {
    setTitle('');
    setNotes('');
    setSubmitted(false);
    setError(null);
  }

  function close() {
    if (saving) return;
    reset();
    onClose();
  }

  async function submit() {
    if (!client) return;
    setSubmitted(true);
    setError(null);
    if (titleError || notesError) return;
    setSaving(true);
    try {
      const workout = await assignWorkout({ trainerId, clientId: client.id, title, notes });
      reset();
      onAssigned(workout);
    } catch (caught) {
      setError(friendlyError(caught, 'Could not assign the workout. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      visible={client !== null}
      title="Assign workout"
      subtitle={client ? `For ${client.name}` : undefined}
      onClose={close}
      testID="assign-workout-sheet">
      {error ? <Banner message={error} testID="assign-error" /> : null}
      <TextField
        label="Title"
        value={title}
        onChangeText={setTitle}
        error={submitted ? titleError : null}
        placeholder="Lower body strength"
        maxLength={limits.titleMax}
        autoCapitalize="sentences"
        autoCorrect
        returnKeyType="next"
        testID="workout-title-input"
      />
      <TextField
        label="Notes / exercises"
        value={notes}
        onChangeText={setNotes}
        error={submitted ? notesError : null}
        placeholder={'Back squat 5 x 5\nRomanian deadlift 3 x 8\nWalking lunges 3 x 12'}
        maxLength={limits.notesMax}
        showCount
        multiline
        autoCapitalize="sentences"
        autoCorrect
        testID="workout-notes-input"
      />
      <Button label="Assign workout" icon="send" onPress={() => void submit()} loading={saving} testID="assign-submit-button" />
    </Sheet>
  );
}
