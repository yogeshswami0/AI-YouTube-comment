import Persona from "../models/Persona.models.js";

export async function createPersona(req, res, next) {
  try {
    const { name, tone, creatorBio, vocabulary, examples, isDefault } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    // If this is being set as default, unset all others for this user
    if (isDefault) {
      await Persona.updateMany({ userId: req.user._id }, { $set: { isDefault: false } });
    }

    const persona = await Persona.create({
      userId: req.user._id,
      name, tone, creatorBio, vocabulary, examples, isDefault: isDefault ?? false,
    });

    return res.status(201).json({ data: persona });
  } catch (err) {
    next(err);
  }
}

export async function listPersonas(req, res, next) {
  try {
    const personas = await Persona.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
    return res.json({ data: personas });
  } catch (err) {
    next(err);
  }
}

export async function getPersona(req, res, next) {
  try {
    const persona = await Persona.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    if (!persona) return res.status(404).json({ error: 'Persona not found' });
    return res.json({ data: persona });
  } catch (err) {
    next(err);
  }
}

export async function updatePersona(req, res, next) {
  try {
    const { isDefault, ...fields } = req.body;
    if (isDefault) {
      await Persona.updateMany({ userId: req.user._id }, { $set: { isDefault: false } });
    }
    const persona = await Persona.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { ...fields, ...(isDefault !== undefined && { isDefault }) },
      { returnDocument: 'after' }
    );
    if (!persona) return res.status(404).json({ error: 'Persona not found' });
    return res.json({ data: persona });
  } catch (err) {
    next(err);
  }
}

export async function deletePersona(req, res, next) {
  try {
    const persona = await Persona.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!persona) return res.status(404).json({ error: 'Persona not found' });
    return res.json({ message: 'Persona deleted' });
  } catch (err) {
    next(err);
  }
}


export async function analyzePersona(req, res, next) {
  try {
    const { bio } = req.body;
    if (!bio || bio.trim().length < 10) {
      return res.status(400).json({ error: 'Please provide a bio of at least 10 characters' });
    }

    // TODO: replace this stub with an AI analysis service when available
    const result = {
      tone: 'friendly',
      creatorBio: bio.trim(),
    };

    return res.json({ data: result });
  } catch (err) {
    next(err);
  }
}