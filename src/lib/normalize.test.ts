import { describe, expect, it } from 'vitest';
import { meetsMin, words } from './normalize';

describe('normalize', () => {
  it('AC-7.1: «Figma, SQL» на Q4 проходит порог', () => {
    expect(meetsMin(4, 'Figma, SQL')).toBe(true);
  });

  it('AC-7.2: 4 слова на Q1 не проходят', () => {
    expect(meetsMin(1, 'ревью кода планирование спринта')).toBe(false);
  });

  it('Q1–Q3: 5 слов проходят', () => {
    expect(meetsMin(1, 'ревью кода и планирование спринта')).toBe(true);
    expect(meetsMin(2, 'запуск приложения для курьеров быстро')).toBe(true);
    expect(meetsMin(3, 'перейдёт на другой проект CRM')).toBe(true);
  });

  it('Q4: одно слово не проходит', () => {
    expect(meetsMin(4, 'Figma')).toBe(false);
  });

  it('паразиты «ну», «э», «типа» не считаются', () => {
    expect(words('ну э типа ревью кода')).toEqual(['ревью', 'кода']);
    expect(meetsMin(1, 'ну ну э типа ревью кода планирование спринта')).toBe(false);
  });

  it('пунктуация и пробелы не считаются словами', () => {
    expect(words('  Figma,   SQL ...  ')).toEqual(['figma', 'sql']);
  });

  it('названия с символами — одно слово', () => {
    expect(words('C++ и C# и B2B-аналитика')).toEqual(['c++', 'и', 'c#', 'и', 'b2b-аналитика']);
  });
});
