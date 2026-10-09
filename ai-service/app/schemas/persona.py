from pydantic import BaseModel, Field
from typing import Literal, Optional


class PersonaExample(BaseModel):
    comment_text: str
    reply_text:   str


class PersonaConfig(BaseModel):
    persona_id:    str
    name:          str
    tone:          Literal["friendly", "professional", "humorous", "promotional","appreciative","informative","supportive","apologetic","neutral"]
    system_prompt: Optional[str] = None
    vocabulary:    list[str]     = Field(default_factory=list)
    examples:      list[PersonaExample] = Field(default_factory=list)
