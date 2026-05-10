import React, { createContext, useContext, useMemo, useState } from "react";

export type ClientRuntimeTask = {
  id: string;
  type: "download";
  status: "running";
  title: string;
  progress: number;
  detail: string;
  startedAt: string;
  updatedAt: string;
  bookId?: string;
};

type TaskContextValue = {
  tasks: ClientRuntimeTask[];
  upsertTask: (task: ClientRuntimeTask) => void;
  removeTask: (id: string) => void;
};

const TaskContext = createContext<TaskContextValue | undefined>(undefined);

export const TaskProvider = ({ children }: { children: React.ReactNode }) => {
  const [tasks, setTasks] = useState<ClientRuntimeTask[]>([]);

  const value = useMemo<TaskContextValue>(
    () => ({
      tasks,
      upsertTask: (task) => {
        setTasks((current) => {
          const index = current.findIndex((entry) => entry.id === task.id);
          if (index === -1) {
            return [...current, task];
          }

          const next = [...current];
          next[index] = task;
          return next;
        });
      },
      removeTask: (id) => {
        setTasks((current) => current.filter((task) => task.id !== id));
      },
    }),
    [tasks],
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
};

export const useTasks = () => {
  const context = useContext(TaskContext);
  if (!context) {
    throw new Error("useTasks must be used within a TaskProvider");
  }

  return context;
};
