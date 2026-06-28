import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";

export const usersRouter = Router();

const userSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  current_test_date: z.string().datetime().optional(),
});

usersRouter.post("/", async (req, res, next) => {
  try {
    const { email, name, current_test_date } = userSchema.parse(req.body);
    const { data: existing } = await supabase
      .from("users")
      .select("id, email")
      .eq("email", email)
      .single();

    if (existing) {
      if (current_test_date) {
        await supabase
          .from("users")
          .update({ current_test_date })
          .eq("id", existing.id);
      }
      return res.json({ ...existing, current_test_date });
    }

    const { data, error } = await supabase
      .from("users")
      .insert({ email, name: name || null, current_test_date: current_test_date || null })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

usersRouter.get("/:id", async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});
