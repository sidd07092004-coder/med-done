import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AppLayout } from './layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { PagesListPage } from './pages/PagesListPage';
import { PageEditorPage } from './pages/PageEditorPage';
import { ReviewQueuePage } from './pages/review/ReviewQueuePage';
import { PublicPreviewPage } from './pages/PublicPreview';
import { StatsPage } from './pages/StatsPage';
import { UsersPage } from './pages/UsersPage';
import { MediaPage } from './pages/MediaPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { DataPage } from './pages/DataPage';
import { GroupManagerPage } from './pages/GroupManagerPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/pages" replace />} />
        <Route path="pages" element={<PagesListPage />} />
        <Route path="pages/:id" element={<PageEditorPage />} />
        <Route
          path="review"
          element={
            <ProtectedRoute adminOnly>
              <ReviewQueuePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="stats"
          element={
            <ProtectedRoute adminOnly>
              <StatsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="users"
          element={
            <ProtectedRoute adminOnly>
              <UsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="groups"
          element={
            <ProtectedRoute adminOnly>
              <GroupManagerPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="audit-log"
          element={
            <ProtectedRoute adminOnly>
              <AuditLogPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="data"
          element={
            <ProtectedRoute adminOnly>
              <DataPage />
            </ProtectedRoute>
          }
        />
        <Route path="media" element={<MediaPage />} />
        <Route path="preview" element={<PublicPreviewPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
