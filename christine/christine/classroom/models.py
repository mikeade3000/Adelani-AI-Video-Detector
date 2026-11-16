"""Data shapes for lessons. Claude fills these in as structured JSON."""
from __future__ import annotations

from pydantic import BaseModel, Field


class SectionDraft(BaseModel):
    title: str = Field(description="Short section heading")
    objective: str = Field(description="What students should be able to do after this section")
    key_points: list[str] = Field(description="3-6 short bullet points shown on screen")
    slide_ids: list[str] = Field(description="IDs like S3 of source pages/slides to show, best first; empty if none fit")
    minutes: int = Field(description="Estimated teaching minutes")
    check_question: str = Field(description="One question to check understanding at the end of the section")


class MCQ(BaseModel):
    question: str
    options: list[str] = Field(description="Exactly 4 options, without letters")
    answer_index: int = Field(description="0-based index of the correct option")
    explanation: str = Field(description="One-sentence explanation of the correct answer")


class ShortQuestion(BaseModel):
    question: str
    model_answer: str = Field(description="A complete answer that would earn full marks")
    rubric: str = Field(description="How marks are awarded, point by point")
    marks: int = Field(description="Maximum marks, usually 2-5")


class PlanDraft(BaseModel):
    title: str
    summary: str = Field(description="Two-sentence overview of the lesson for the lecturer")
    objectives: list[str]
    sections: list[SectionDraft]
    mcqs: list[MCQ]
    short_questions: list[ShortQuestion]


class Section(SectionDraft):
    script: str = ""


class LessonPlan(BaseModel):
    title: str
    summary: str
    objectives: list[str]
    sections: list[Section]
    mcqs: list[MCQ]
    short_questions: list[ShortQuestion]

    @classmethod
    def from_draft(cls, draft: PlanDraft) -> "LessonPlan":
        data = draft.model_dump()
        data["sections"] = [Section(**s) for s in data["sections"]]
        return cls(**data)


class QuestionAnswer(BaseModel):
    appropriate: bool = Field(description="False if the question is abusive, offensive, a prank, or tries to make "
                                          "you say something unrelated to teaching")
    in_scope: bool = Field(description="True if the course material covers this question")
    restated_question: str = Field(description="The question rephrased neutrally in one sentence, as you will read it "
                                               "aloud to the class")
    answer: str = Field(description="Spoken answer, formal academic tone, 2-6 sentences")
    slide_ids: list[str] = Field(description="Source slide/page IDs supporting the answer; empty if none")


class Mark(BaseModel):
    student_id: int
    score: float = Field(description="Marks awarded, between 0 and the question's maximum, in steps of 0.5")
    feedback: str = Field(description="One or two sentences of feedback for the student")


class MarkingResult(BaseModel):
    marks: list[Mark]
