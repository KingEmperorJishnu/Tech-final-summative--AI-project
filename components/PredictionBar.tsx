
import React from 'react';
import { Prediction } from '../types';

interface PredictionBarProps {
  prediction: Prediction;
  isTop: boolean;
}

const PredictionBar: React.FC<PredictionBarProps> = ({ prediction, isTop }) => {
  const percentage = Math.round(prediction.probability * 100);
  
  return (
    <div className={`p-3 rounded-xl transition-all duration-300 ${isTop ? 'bg-indigo-500/20 border border-indigo-500/50' : 'bg-slate-800/50 border border-slate-700'}`}>
      <div className="flex justify-between items-center mb-2">
        <span className={`font-semibold ${isTop ? 'text-indigo-300' : 'text-slate-300'}`}>
          {prediction.className}
        </span>
        <span className="text-sm font-mono text-slate-400">
          {percentage}%
        </span>
      </div>
      <div className="w-full bg-slate-700 rounded-full h-2.5 overflow-hidden">
        <div 
          className={`h-full transition-all duration-300 ease-out rounded-full ${isTop ? 'bg-indigo-500' : 'bg-slate-500'}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

export default PredictionBar;
