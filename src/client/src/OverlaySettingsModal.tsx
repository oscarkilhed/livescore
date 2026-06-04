import React from 'react';
import { CompetitorWithTotalScore } from './types';

interface StageOption {
  value: number;
  label: string;
}

interface OverlaySettingsModalProps {
  competitor: CompetitorWithTotalScore;
  startStage: number;
  availableStages: StageOption[];
  onStartStageChange: (n: number) => void;
  onDownload: () => void;
  onClose: () => void;
}

const OverlaySettingsModal: React.FC<OverlaySettingsModalProps> = ({
  competitor,
  startStage,
  availableStages,
  onStartStageChange,
  onDownload,
  onClose,
}) => {
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal-box" role="dialog" aria-modal="true">
        <h2>Overlay settings</h2>
        <p className="modal-competitor-name">{competitor.name} &mdash; {competitor.division}</p>

        <div className="modal-field">
          <label htmlFor="start-stage-select">Cumulative standings start stage</label>
          <p className="modal-field-hint">
            If the competitor starts filming at stage 5, set this to Stage 5.
            Standings will be calculated from that stage onward.
          </p>
          <select
            id="start-stage-select"
            value={startStage}
            onChange={(e) => onStartStageChange(Number(e.target.value))}
          >
            {availableStages.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="modal-actions">
          <button className="modal-btn modal-btn-primary" onClick={onDownload}>
            Download ZIP
          </button>
          <button className="modal-btn modal-btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default OverlaySettingsModal;
