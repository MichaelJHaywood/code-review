/**
 * User Settings - GraphQL Review Exercise (with blocking HTTP call)
 */

import { ApolloServer } from "@apollo/server";
import { Kysely } from "kysely";

interface Database {
  users: {
    id: string;
    email: string;
    role: "ADMIN" | "MEMBER";
    created_at: Date;
  };
  settings: {
    id: string;
    user_id: string;
    key: string;
    value: string;
    updated_at: Date;
    updated_by: string | null;
  };
}

declare const db: Kysely<Database>;

const typeDefs = `#graphql
enum UserRole { ADMIN MEMBER }

type User {
    id: ID!
    email: String!
    role: UserRole!
    createdAt: String!
    settingsCount: Int!
}

type Setting {
    id: ID!
    key: String!
    value: String!
    updatedAt: String!
    updatedBy: User
}

type Query {
    user(id: ID!): User
    users(ids: [ID!]!): [User]!
}

input SettingInput { key: String!, value: String! }

type SettingsPayload { success: Boolean!, user: User!, settings: [Setting!]! }

type Mutation {
    updateSettings(userId: ID!, settings: [SettingInput!]!): SettingsPayload!
}
`;

const resolvers = {
  Query: {
    user: async (_: unknown, { id }: { id: string }) => {
      const u = await db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst();
      return u ? { ...u, createdAt: u.created_at.toISOString() } : null;
    },

    users: async (_: unknown, { ids }: { ids: string[] }) => {
      const rows = await Promise.all(
        ids.map((id) =>
          db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst()
        )
      );

      return rows.map((u) => (u ? { ...u, createdAt: u.created_at.toISOString() } : null));
    },
  },

  User: {
    settingsCount: async (u: { id: string }) => {
      const r = await db
        .selectFrom("settings")
        .select(db.fn.count("id").as("count"))
        .where("user_id", "=", u.id)
        .executeTakeFirst();

      return Number(r?.count ?? 0);
    },
  },

  Setting: {
    updatedBy: async (s: { updatedById?: string }) => {
      if (!s.updatedById) return null;
      const u = await db
        .selectFrom("users")
        .selectAll()
        .where("id", "=", s.updatedById)
        .executeTakeFirst();

      return u ? { ...u, createdAt: u.created_at.toISOString() } : null;
    },
  },

  Mutation: {
    updateSettings: async (
      _: unknown,
      { userId, settings }: { userId: string; settings: Array<{ key: string; value: string }> },
      ctx: { userId?: string; role?: "ADMIN" | "MEMBER" }
    ) => {
      const u = await db
        .selectFrom("users")
        .selectAll()
        .where("id", "=", userId)
        .executeTakeFirst();

      if (!u) throw new Error("User not found");

      const now = new Date();

      const updated: Array<{
        id: string;
        key: string;
        value: string;
        updatedAt: string;
        updatedById?: string | null;
      }> = [];

      for (const { key, value } of settings) {
        const r = await db
          .insertInto("settings")
          .values({
            id: crypto.randomUUID(),
            user_id: userId,
            key,
            value,
            updated_at: now,
            updated_by: ctx.userId ?? null,
          })
          .onConflict((oc) =>
            oc.columns(["user_id", "key"]).doUpdateSet({
              value,
              updated_at: now,
            })
          )
          .returning(["id", "key", "value", "updated_at", "updated_by"])
          .executeTakeFirstOrThrow();

        updated.push({
          id: r.id,
          key: r.key,
          value: r.value,
          updatedAt: r.updated_at.toISOString(),
          updatedById: r.updated_by,
        });
      }

      const auditResponse = await fetch(
        "http://audit-service.internal/events",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            eventType: "USER_SETTINGS_UPDATED",
            userId,
            actorId: ctx.userId ?? null,
            at: now.toISOString(),
            changes: updated.map((s) => ({ key: s.key, value: s.value })),
          }),
        }
      );

      if (!auditResponse.ok) {
        throw new Error(`Audit service failed: ${auditResponse.status}`);
      }

      return {
        success: true,
        user: { ...u, createdAt: u.created_at.toISOString() },
        settings: updated,
      };
    },
  },
};

export const server = new ApolloServer({
  typeDefs,
  resolvers,
});