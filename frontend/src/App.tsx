import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import { Layout } from './components/Layout'
import { AlertsPage } from './pages/Alerts'
import { AuditLogsPage } from './pages/AuditLogs'
import { ComplaintTrackingPage } from './pages/ComplaintTracking'
import { ComplaintsPage } from './pages/Complaints'
import { DashboardPage } from './pages/Dashboard'
import { HelplinePage } from './pages/Helpline'
import { KnowledgeBasePage } from './pages/KnowledgeBase'
import { LoginPage } from './pages/Login'
import { ModelEvaluationPage } from './pages/ModelEvaluation'
import { NetworkPage } from './pages/Network'
import { ReplayPage } from './pages/Replay'
import { ReportsPage } from './pages/Reports'
import { SimulationPage } from './pages/Simulation'
import { TransformerDetailPage } from './pages/TransformerDetail'
import { TransformersPage } from './pages/Transformers'
import { UsersPage } from './pages/Users'
import { WorkOrderDetailPage } from './pages/WorkOrderDetail'
import { WorkOrdersPage } from './pages/WorkOrders'

function Protected(){const {user}=useAuth();const location=useLocation();return user?<Layout/>:<Navigate to="/login" replace state={{from:location.pathname}}/>}
export default function App(){return <Routes>
  <Route path="/login" element={<LoginPage/>}/><Route path="/helpline" element={<HelplinePage/>}/><Route path="/track" element={<ComplaintTrackingPage/>}/><Route path="/track/:reference" element={<ComplaintTrackingPage/>}/>
  <Route element={<Protected/>}><Route index element={<DashboardPage/>}/><Route path="map" element={<NetworkPage/>}/><Route path="transformers" element={<TransformersPage/>}/><Route path="transformers/:id" element={<TransformerDetailPage/>}/><Route path="alerts" element={<AlertsPage/>}/><Route path="complaints" element={<ComplaintsPage/>}/><Route path="work-orders" element={<WorkOrdersPage/>}/><Route path="work-orders/:id" element={<WorkOrderDetailPage/>}/><Route path="simulation" element={<SimulationPage/>}/><Route path="model-evaluation" element={<ModelEvaluationPage/>}/><Route path="replay/:id" element={<ReplayPage/>}/><Route path="reports" element={<ReportsPage/>}/><Route path="knowledge-base" element={<KnowledgeBasePage/>}/><Route path="users" element={<UsersPage/>}/><Route path="audit-logs" element={<AuditLogsPage/>}/></Route>
  <Route path="*" element={<Navigate to="/" replace/>}/>
</Routes>}
