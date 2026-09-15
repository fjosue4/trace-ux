import type { SurveyQuestion } from '../../../../api';
import { Icon } from '../../../ui/Icon';
import { Input, Select } from '../../../ui/fields';

type QuestionEditorProps = {
  question: SurveyQuestion;
  index: number;
  onPatchQuestion: (index: number, patch: Partial<SurveyQuestion>) => void;
  onRemove: (index: number) => void;
};

export function QuestionEditor({ question, index, onPatchQuestion, onRemove }: QuestionEditorProps) {
  return (
    <div className="hub-question">
      <Input
        placeholder="Question text"
        aria-label={`Question ${index + 1} text`}
        value={question.label}
        onChange={(e) => onPatchQuestion(index, { label: e.target.value })}
      />
      <Select
        value={question.type}
        ariaLabel={`Question ${index + 1} type`}
        onChange={(value) =>
          onPatchQuestion(index, {
            type: value as SurveyQuestion['type'],
            max: value === 'rating' ? 5 : undefined,
            options: value === 'choice' ? ['Yes', 'No'] : undefined,
          })
        }
        options={[
          { value: 'rating', label: 'Rating' },
          { value: 'choice', label: 'Choice' },
          { value: 'text', label: 'Text' },
        ]}
      />
      {question.type === 'rating' && (
        <Select
          value={String(question.max || 5)}
          ariaLabel={`Question ${index + 1} scale`}
          onChange={(value) => onPatchQuestion(index, { max: Number(value) })}
          options={[
            { value: '5', label: '1–5 stars' },
            { value: '10', label: '0–10 NPS' },
          ]}
        />
      )}
      {question.type === 'choice' && (
        <Input
          placeholder="Options, comma separated"
          aria-label={`Question ${index + 1} options`}
          value={(question.options ?? []).join(', ')}
          onChange={(e) => onPatchQuestion(index, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
        />
      )}
      <label className="hub-question__optional">
        <input
          type="checkbox"
          checked={!!question.optional}
          onChange={(e) => onPatchQuestion(index, { optional: e.target.checked })}
        />
        Optional
      </label>
      <button
        className="icon-btn"
        type="button"
        title="Remove question"
        aria-label={`Remove question ${index + 1}`}
        onClick={() => onRemove(index)}
      >
        <Icon name="trash" size={14} />
      </button>
    </div>
  );
}
